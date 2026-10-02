"""Obtención de datos de Yahoo Finance y composición de la respuesta del API."""

from __future__ import annotations

import logging
import os
import threading
from datetime import date
from typing import Any, Callable, Optional

from .cache import TTLCache
from .statements import (
    build_annual,
    build_ltm,
    finite_number,
    finite_or_none,
    is_empty,
    normalize_quote,
)

log = logging.getLogger("equityscope")

TickerFactory = Callable[[str], Any]


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


def _default_ticker_factory(symbol: str) -> Any:
    import yfinance as yf  # import diferido: los tests no lo necesitan

    return yf.Ticker(symbol)


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


def _fx_rate(factory: TickerFactory, base: str, quote: str) -> Optional[float]:
    """Unidades de ``quote`` por 1 ``base`` (par de Yahoo, p. ej. EURUSD=X)."""
    try:
        closes = factory(f"{base}{quote}=X").history(period="5d")["Close"].dropna()
        rate = finite_or_none(closes.iloc[-1]) if len(closes) else None
        return rate if rate and rate > 0 else None
    except Exception:
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

    return {
        "ticker": symbol,
        "name": str(info.get("longName") or info.get("shortName") or symbol),
        "currency": currency,
        "price": price,
        "periods": annual,
        "ltm": ltm,
        "source": "Yahoo Finance (yfinance)",
        "asOf": date.today().isoformat(),
        "warnings": warnings,
    }


def get_company(symbol: str) -> dict[str, Any]:
    """Como ``fetch_company`` pero con caché TTL (por defecto 30 min)."""
    return _cache.get_or_create(symbol, lambda: fetch_company(symbol))
