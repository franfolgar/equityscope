"""Obtención de datos de Yahoo Finance y composición de la respuesta del API."""

from __future__ import annotations

import logging
import os
import re
import threading
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional

from .cache import TTLCache
from .statements import (
    ALIASES,
    ANNUAL_MATCH_DAYS,
    build_annual,
    build_ltm,
    finite_number,
    finite_or_none,
    is_empty,
    lookup,
    nearest_period,
    normalize_quote,
    sorted_periods,
)

log = logging.getLogger("equityscope")

TickerFactory = Callable[[str], Any]

MARKET_EXCHANGES: dict[str, tuple[str, ...]] = {
    "spain": ("MCE", "MAD"),
    "nasdaq": ("NMS", "NGM", "NCM"),
    "nyse": ("NYQ",),
    "london": ("LSE", "AQS", "CXE"),
    "germany": ("GER", "FRA", "BER", "EUX", "STU", "HAM", "DUS", "HAN", "MUN"),
    "france": ("PAR", "ENX"),
    "canada": ("TOR", "VAN", "CNQ", "NEO"),
    "japan": ("JPX", "OSA", "FKA", "SAP"),
}

MARKET_LABELS = {
    "spain": "España · Bolsa de Madrid",
    "nasdaq": "NASDAQ",
    "nyse": "NYSE",
    "london": "London Stock Exchange",
    "germany": "Alemania · XETRA y otras bolsas",
    "france": "Francia · Euronext",
    "canada": "Canadá · Toronto y otras bolsas",
    "japan": "Japón",
}


class DataError(Exception):
    """Error esperado de datos; ``main.py`` lo traduce a una respuesta HTTP."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _env_number(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return float(default)


_upstream_slots = threading.BoundedSemaphore(int(_env_number("UPSTREAM_CONCURRENCY", 4)))
_cache = TTLCache(_env_number("CACHE_TTL_SECONDS", 1800), max_items=256)
_search_cache = TTLCache(300, max_items=128)
_currency_cache = TTLCache(900, max_items=128)


def _default_ticker_factory(symbol: str) -> Any:
    import yfinance as yf  # import diferido: los tests no lo necesitan

    return yf.Ticker(symbol)


def _default_search_factory(query: str) -> Any:
    import yfinance as yf

    return yf.Search(
        query,
        max_results=12,
        news_count=0,
        lists_count=0,
        include_cb=False,
        timeout=12,
    )


def _default_market_factory(market: str) -> Any:
    import yfinance as yf

    query = yf.EquityQuery("is-in", ["exchange", *MARKET_EXCHANGES[market]])
    return yf.screen(query, size=10, sortField="intradaymarketcap", sortAsc=False)


def search_tickers(
    query: str,
    search_factory: Optional[Callable[[str], Any]] = None,
    market_factory: Optional[Callable[[str], Any]] = None,
    market: Optional[str] = None,
) -> list[dict[str, str]]:
    """Busca por nombre/símbolo y, opcionalmente, restringe o lista una bolsa."""
    normalized = query.strip()
    if len(normalized) > 80 or (not normalized and not market):
        raise DataError(400, "Escribe un ticker/nombre o selecciona un mercado.")
    if market and market not in MARKET_EXCHANGES:
        raise DataError(400, "Mercado de búsqueda no válido.")
    factory = search_factory or _default_search_factory
    market_source = market_factory or _default_market_factory

    def fetch() -> list[dict[str, str]]:
        if not _upstream_slots.acquire(timeout=15):
            raise DataError(503, "El servicio está ocupado; inténtalo de nuevo en unos segundos.")
        try:
            if normalized:
                response = factory(normalized)
                quotes = getattr(response, "quotes", [])
                if market:
                    allowed_exchanges = MARKET_EXCHANGES[market]
                    quotes = [
                        quote for quote in quotes
                        if isinstance(quote, dict) and quote.get("exchange") in allowed_exchanges
                    ]
            else:
                response = market_source(market or "")
                quotes = response.get("quotes", []) if isinstance(response, dict) else []
                allowed_exchanges = MARKET_EXCHANGES[market or ""]
                quotes = [
                    quote for quote in quotes
                    if isinstance(quote, dict) and quote.get("exchange") in allowed_exchanges
                ]
            results: list[dict[str, str]] = []
            seen: set[str] = set()
            for quote in quotes:
                if not isinstance(quote, dict) or quote.get("quoteType") != "EQUITY":
                    continue
                ticker = quote.get("symbol")
                if not isinstance(ticker, str) or not re.fullmatch(r"[A-Za-z0-9.^=-]{1,15}", ticker):
                    continue
                ticker = ticker.upper()
                if ticker in seen:
                    continue
                name = (
                    quote.get("longname")
                    or quote.get("longName")
                    or quote.get("shortname")
                    or quote.get("shortName")
                    or ticker
                )
                display_market = quote.get("exchDisp") or (
                    MARKET_LABELS[market] if market else quote.get("exchange")
                ) or "Mercado no indicado"
                results.append({
                    "ticker": ticker,
                    "name": str(name),
                    "market": str(display_market),
                })
                seen.add(ticker)
                if len(results) == 10:
                    break
            return results
        except DataError:
            raise
        except Exception as error:
            log.exception("Fallo buscando empresas para %r en %s", normalized, market)
            raise DataError(
                502,
                "No se pudo completar la búsqueda de empresas en Yahoo Finance. Inténtalo de nuevo.",
            ) from error
        finally:
            _upstream_slots.release()

    return _search_cache.get_or_create(f"{market or '*'}:{normalized.casefold()}", fetch)


def _fast_info(ticker: Any, key: str) -> Any:
    try:
        return ticker.fast_info[key]
    except Exception:
        return None


def _safe_info(ticker: Any) -> dict[str, Any]:
    try:
        info = ticker.get_info()
    except Exception:
        log.warning("get_info() falló", exc_info=True)
        return {}
    return info if isinstance(info, dict) else {}


def _last_price(ticker: Any, info: dict[str, Any]) -> float:
    price = finite_number(_fast_info(ticker, "last_price"))
    if price <= 0:
        price = finite_number(info.get("currentPrice") or info.get("regularMarketPrice"))
    if price <= 0:
        try:
            history = ticker.history(period="5d", auto_adjust=False)
            closes = history["Close"].dropna()
            if len(closes):
                price = finite_number(closes.iloc[-1])
        except Exception:
            log.warning("history() falló", exc_info=True)
    return price


def _fx_rate(
    factory: TickerFactory,
    base: str,
    quote: str,
    *,
    log_errors: bool = True,
) -> Optional[float]:
    """Unidades de ``quote`` por 1 ``base`` (par de Yahoo, p. ej. EURUSD=X)."""
    try:
        closes = factory(f"{base}{quote}=X").history(period="5d")["Close"].dropna()
        rate = finite_or_none(closes.iloc[-1]) if len(closes) else None
        return rate if rate and rate > 0 else None
    except Exception:
        if log_errors:
            log.warning("No se pudo obtener el tipo de cambio %s/%s", base, quote, exc_info=True)
        return None


def align_currency(
    factory: TickerFactory, price: float, quote_currency: str, financial_currency: str
) -> tuple[float, str, list[str]]:
    """Devuelve (precio, moneda, avisos) expresados en la moneda de los estados."""
    if not financial_currency or financial_currency == quote_currency:
        return price, quote_currency, []
    rate = _fx_rate(factory, financial_currency, quote_currency)
    if rate is None:
        return price, quote_currency, [
            f"Los estados están en {financial_currency} pero la cotización en {quote_currency} "
            "y no se pudo convertir: la valoración por acción no es fiable."
        ]
    return price / rate, financial_currency, [
        f"Los estados están en {financial_currency} y la cotización en {quote_currency}: el precio "
        f"se ha convertido a {financial_currency} (1 {financial_currency} = {rate:.4f} {quote_currency}). "
        "Si es un ADR, el ratio ADR/acción no se ajusta y el precio por acción puede no ser comparable."
    ]


def get_conversion_rate(
    source: str,
    target: str,
    ticker_factory: Optional[TickerFactory] = None,
) -> dict[str, Any]:
    """Devuelve unidades de moneda destino por unidad de moneda origen."""
    if not re.fullmatch(r"[A-Z]{3}", source) or not re.fullmatch(r"[A-Z]{3}", target):
        raise DataError(400, "Código de moneda no válido.")
    if source == target:
        return {
            "source": source,
            "target": target,
            "rate": 1.0,
            "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    factory = ticker_factory or _default_ticker_factory

    def pair_rate(base: str, quote: str) -> Optional[float]:
        direct = _fx_rate(factory, base, quote, log_errors=False)
        if direct is not None:
            return direct
        inverse = _fx_rate(factory, quote, base, log_errors=False)
        return 1 / inverse if inverse else None

    def fetch() -> dict[str, Any]:
        if not _upstream_slots.acquire(timeout=15):
            raise DataError(503, "El servicio está ocupado; inténtalo de nuevo en unos segundos.")
        try:
            rate = pair_rate(source, target)
            if rate is None and source != "USD" and target != "USD":
                source_to_usd = pair_rate(source, "USD")
                target_to_usd = pair_rate(target, "USD")
                if source_to_usd is not None and target_to_usd:
                    rate = source_to_usd / target_to_usd
            if rate is None or rate <= 0:
                raise DataError(
                    502,
                    f"No se pudo obtener el cambio de {source} a {target} desde Yahoo Finance.",
                )
            return {
                "source": source,
                "target": target,
                "rate": rate,
                "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        finally:
            _upstream_slots.release()

    return _currency_cache.get_or_create(f"{source}:{target}", fetch)


def fetch_company(symbol: str, ticker_factory: Optional[TickerFactory] = None) -> dict[str, Any]:
    factory = ticker_factory or _default_ticker_factory
    if not _upstream_slots.acquire(timeout=15):
        raise DataError(503, "El servicio está ocupado; inténtalo de nuevo en unos segundos.")
    try:
        return _fetch(symbol, factory)
    except DataError:
        raise
    except Exception as error:
        log.exception("Fallo consultando %s", symbol)
        raise DataError(
            502,
            f"No se pudieron obtener los datos de {symbol} desde Yahoo Finance. "
            "Puede ser un límite temporal de consultas; inténtalo de nuevo en unos minutos.",
        ) from error
    finally:
        _upstream_slots.release()


def _fetch(symbol: str, factory: TickerFactory) -> dict[str, Any]:
    ticker = factory(symbol)
    income, balance, cashflow = ticker.financials, ticker.balance_sheet, ticker.cashflow
    if is_empty(income) or is_empty(balance):
        raise DataError(404, f"Yahoo Finance no publica estados financieros suficientes para {symbol}.")

    annual, warnings = build_annual(income, balance, cashflow)
    if not annual:
        raise DataError(404, f"Yahoo Finance no publica ingresos anuales utilizables para {symbol}.")

    ltm, ltm_warnings = build_ltm(
        annual,
        ticker.quarterly_financials,
        ticker.quarterly_balance_sheet,
        ticker.quarterly_cashflow,
        balance,
    )
    warnings += ltm_warnings

    info = _safe_info(ticker)
    price = _last_price(ticker, info)
    if price <= 0:
        raise DataError(404, f"No se encontró una cotización reciente para {symbol}.")

    currency = str(info.get("currency") or _fast_info(ticker, "currency") or "USD")
    price, currency = normalize_quote(price, currency)
    financial_currency = info.get("financialCurrency")
    if financial_currency:
        _, financial_currency = normalize_quote(1.0, str(financial_currency))
        price, currency, fx_warnings = align_currency(factory, price, currency, financial_currency)
        warnings += fx_warnings

    if ltm["dilutedShares"] <= 0:
        ltm["dilutedShares"] = finite_number(info.get("sharesOutstanding"))
    for period in annual:
        if period["dilutedShares"] <= 0:
            period["dilutedShares"] = ltm["dilutedShares"]

    statement_period = annual[-1]["period"]
    income_periods = sorted_periods(income)
    latest_income_period = next(
        (
            period for period in reversed(income_periods)
            if (lookup(income, ALIASES["revenue"], period) or 0) > 0
        ),
        None,
    )
    balance_period = nearest_period(sorted_periods(balance), latest_income_period, ANNUAL_MATCH_DAYS)
    cashflow_period = nearest_period(sorted_periods(cashflow), latest_income_period, ANNUAL_MATCH_DAYS)
    missing_metrics: list[str] = []
    metric_sources = (
        ("Ingresos", income, "revenue", latest_income_period),
        ("EBIT", income, "ebit", latest_income_period),
        ("Impuestos", income, "taxExpense", latest_income_period),
        ("Beneficio neto", income, "netIncome", latest_income_period),
        ("Acciones diluidas", income, "dilutedShares", latest_income_period),
        ("Intereses pagados", income, "interestExpense", latest_income_period),
        ("Intereses cobrados", income, "interestIncome", latest_income_period),
        ("Intereses minoritarios", income, "minorityInterest", latest_income_period),
        ("Caja", balance, "cash", balance_period),
        ("Inversiones a corto plazo", balance, "shortTermInvestments", balance_period),
        ("Deuda a corto plazo", balance, "shortTermDebt", balance_period),
        ("Deuda a largo plazo", balance, "longTermDebt", balance_period),
        ("Patrimonio", balance, "equity", balance_period),
        ("Inventario", balance, "inventory", balance_period),
        ("Cuentas por cobrar", balance, "receivables", balance_period),
        ("Cuentas por pagar", balance, "payables", balance_period),
        ("Ingresos diferidos", balance, "unearnedRevenue", balance_period),
        ("Depreciación y amortización", cashflow, "depreciation", cashflow_period),
        ("CapEx", cashflow, "capex", cashflow_period),
    )
    for label, frame, key, period in metric_sources:
        if lookup(frame, ALIASES[key], period) is None:
            missing_metrics.append(label)

    quote_time = finite_or_none(info.get("regularMarketTime"))
    quote_as_of = None
    if quote_time is not None and quote_time > 0:
        quote_as_of = datetime.fromtimestamp(quote_time, timezone.utc).isoformat(timespec="seconds")

    return {
        "ticker": symbol,
        "name": str(info.get("longName") or info.get("shortName") or symbol),
        "currency": currency,
        "market": str(info.get("fullExchangeName") or info.get("exchange") or ""),
        "price": price,
        "periods": annual,
        "ltm": ltm,
        "source": "Yahoo Finance (yfinance)",
        "asOf": date.today().isoformat(),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "statementPeriod": statement_period,
        "quoteAsOf": quote_as_of,
        "missingMetrics": missing_metrics,
        "warnings": warnings,
    }


def get_company(symbol: str) -> dict[str, Any]:
    """Como ``fetch_company`` pero con caché TTL (por defecto 30 min)."""
    return _cache.get_or_create(symbol, lambda: fetch_company(symbol))
