"""Lógica pura de extracción de estados financieros (solo depende de pandas).

Vive separada de ``main.py`` para poder testearla sin FastAPI ni yfinance.
"""

from __future__ import annotations

import math
from typing import Any, Optional, Sequence

# Tolerancias (en días) para emparejar columnas de distintos estados.
ANNUAL_MATCH_DAYS = 60
QUARTER_MATCH_DAYS = 20
# Separación razonable entre dos trimestres consecutivos.
QUARTER_GAP_DAYS = (60, 125)

ALIASES: dict[str, tuple[str, ...]] = {
    "revenue": ("Total Revenue", "Operating Revenue", "Revenue"),
    "ebit": ("Operating Income", "EBIT"),
    "depreciation": ("Depreciation And Amortization", "Depreciation Amortization Depletion", "Depreciation"),
    "interestExpense": ("Interest Expense Non Operating", "Interest Expense", "Interest Paid"),
    "interestIncome": ("Interest Income Non Operating", "Interest Income"),
    "taxExpense": ("Tax Provision", "Income Tax Expense"),
    "netIncome": ("Net Income", "Net Income Common Stockholders", "Net Income Including Noncontrolling Interests"),
    "dilutedShares": ("Diluted Average Shares", "Diluted Shares"),
    "cash": ("Cash And Cash Equivalents", "Cash"),
    "shortTermInvestments": ("Other Short Term Investments", "Short Term Investments"),
    "shortTermDebt": ("Current Debt", "Short Term Debt"),
    "longTermDebt": ("Long Term Debt",),
    "currentLease": ("Current Capital Lease Obligation", "Current Operating Lease Liability"),
    "longTermLease": ("Long Term Capital Lease Obligation", "Long Term Operating Lease Liability"),
    "equity": ("Stockholders Equity", "Total Equity Gross Minority Interest", "Total Stockholder Equity"),
    "inventory": ("Inventory",),
    "receivables": ("Accounts Receivable", "Receivables"),
    "payables": ("Accounts Payable", "Payables And Accrued Expenses"),
    "unearnedRevenue": ("Current Deferred Revenue", "Deferred Revenue"),
    "capex": ("Capital Expenditure", "Capital Expenditures"),
    # En yfinance la partida del estado de resultados se llama "Minority Interests"
    # y la del balance "Minority Interest": se aceptan ambas.
    "minorityInterest": ("Minority Interests", "Minority Interest"),
}

# Cotizaciones en subunidades -> (moneda principal, divisor).
SUBUNIT_CURRENCIES: dict[str, tuple[str, float]] = {
    "GBp": ("GBP", 100.0),
    "GBX": ("GBP", 100.0),
    "ZAc": ("ZAR", 100.0),
    "ZAC": ("ZAR", 100.0),
    "ILA": ("ILS", 100.0),
}


def finite_or_none(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def finite_number(value: Any) -> float:
    result = finite_or_none(value)
    return 0.0 if result is None else result


def is_empty(frame: Any) -> bool:
    return frame is None or getattr(frame, "empty", True)


def lookup(frame: Any, aliases: Sequence[str], period: Any) -> Optional[float]:
    """Primer valor *finito* entre los alias; ``None`` si no hay ninguno.

    Si una etiqueta existe pero su valor es NaN se prueba la siguiente (Yahoo
    suele devolver filas con NaN en ejercicios antiguos).
    """
    if is_empty(frame) or period is None or period not in frame.columns:
        return None
    for label in aliases:
        if label in frame.index:
            value = finite_or_none(frame.at[label, period])
            if value is not None:
                return value
    return None


def statement_value(frame: Any, aliases: Sequence[str], period: Any) -> float:
    value = lookup(frame, aliases, period)
    return 0.0 if value is None else value


def sorted_periods(frame: Any) -> list[Any]:
    if is_empty(frame):
        return []
    return sorted(frame.columns, key=lambda item: str(item))


def format_period(period: Any) -> str:
    if hasattr(period, "strftime"):
        return period.strftime("%Y")
    return str(period)[:4]


def nearest_period(periods: Sequence[Any], target: Any, max_days: int) -> Optional[Any]:
    """Período más cercano a ``target`` dentro de ``max_days``; ``None`` si no hay."""
    best = None
    best_gap = None
    for candidate in periods:
        gap = abs((candidate - target).days)
        if best_gap is None or gap < best_gap:
            best, best_gap = candidate, gap
    if best is None or best_gap is None or best_gap > max_days:
        return None
    return best


def compose_period(
    period: Any,
    income: Any,
    balance: Any,
    cashflow: Any,
    balance_period: Any,
    cashflow_period: Any,
) -> dict[str, Any]:
    """Une una columna de resultados con su balance y cash flow emparejados.

    ``changeInWorkingCapital`` se deja en ``None``: el frontend lo calcula a
    partir de las partidas de balance de dos períodos consecutivos.
    """

    def income_value(key: str) -> float:
        return statement_value(income, ALIASES[key], period)

    def balance_value(key: str) -> float:
        return statement_value(balance, ALIASES[key], balance_period)

    def cash_value(key: str) -> float:
        return statement_value(cashflow, ALIASES[key], cashflow_period)

    ebit = income_value("ebit")
    depreciation = abs(cash_value("depreciation"))
    return {
        "period": format_period(period),
        "revenue": income_value("revenue"),
        "ebit": ebit,
        "depreciation": depreciation,
        "ebitda": ebit + depreciation,
        "interestExpense": abs(income_value("interestExpense")),
        "interestIncome": income_value("interestIncome"),
        "taxExpense": abs(income_value("taxExpense")),
        "netIncome": income_value("netIncome"),
        "dilutedShares": income_value("dilutedShares"),
        "cash": balance_value("cash"),
        "shortTermInvestments": balance_value("shortTermInvestments"),
        "shortTermDebt": balance_value("shortTermDebt"),
        "longTermDebt": balance_value("longTermDebt"),
        "currentLease": balance_value("currentLease"),
        "longTermLease": balance_value("longTermLease"),
        "equity": balance_value("equity"),
        "inventory": balance_value("inventory"),
        "receivables": balance_value("receivables"),
        "payables": balance_value("payables"),
        "unearnedRevenue": balance_value("unearnedRevenue"),
        "capex": abs(cash_value("capex")),
        "changeInWorkingCapital": None,
        "minorityInterest": income_value("minorityInterest"),
    }


ADDITIVE_KEYS = (
    "revenue",
    "ebit",
    "depreciation",
    "ebitda",
    "interestExpense",
    "interestIncome",
    "taxExpense",
    "netIncome",
    "capex",
    "minorityInterest",
)


def add_periods(periods: list[dict[str, Any]], label: str) -> dict[str, Any]:
    """Suma flujos de varios períodos; balance y acciones salen del último."""
    result = dict(periods[-1])
    result["period"] = label
    for key in ADDITIVE_KEYS:
        result[key] = sum(period[key] for period in periods)
    result["dilutedShares"] = periods[-1]["dilutedShares"]
    result["changeInWorkingCapital"] = None
    return result


def build_annual(
    income: Any, balance: Any, cashflow: Any, limit: int = 5
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    balance_periods = sorted_periods(balance)
    cashflow_periods = sorted_periods(cashflow)
    annual: list[dict[str, Any]] = []
    for period in sorted_periods(income)[-limit:]:
        balance_period = nearest_period(balance_periods, period, ANNUAL_MATCH_DAYS)
        cashflow_period = nearest_period(cashflow_periods, period, ANNUAL_MATCH_DAYS)
        item = compose_period(period, income, balance, cashflow, balance_period, cashflow_period)
        if item["revenue"] <= 0:
            continue
        year = item["period"]
        if balance_period is None:
            warnings.append(f"Sin balance emparejable para {year}: sus partidas de balance se muestran a 0.")
        if cashflow_period is None:
            warnings.append(f"Sin cash flow emparejable para {year}: CapEx y D&A se muestran a 0.")
        annual.append(item)
    return annual, warnings


def build_ltm(
    annual: list[dict[str, Any]],
    quarterly_income: Any,
    quarterly_balance: Any,
    quarterly_cashflow: Any,
    annual_balance: Any,
) -> tuple[dict[str, Any], list[str]]:
    """LTM = suma de los últimos cuatro trimestres; si no es fiable, último anual.

    Se rechaza el LTM si faltan trimestres, hay huecos entre ellos, algún
    trimestre no tiene ventas o no se puede emparejar su cash flow (antes se
    emparejaba con el trimestre más cercano sin límite y duplicaba CapEx/D&A).
    """

    def fallback(reason: str) -> tuple[dict[str, Any], list[str]]:
        ltm = dict(annual[-1])
        ltm["period"] = "LTM*"
        return ltm, [f"LTM aproximado con el último ejercicio anual: {reason}"]

    quarters = sorted_periods(quarterly_income)
    if len(quarters) < 4:
        return fallback("Yahoo publica menos de cuatro trimestres.")
    last_four = quarters[-4:]

    gaps = [(last_four[i + 1] - last_four[i]).days for i in range(3)]
    if any(not (QUARTER_GAP_DAYS[0] <= gap <= QUARTER_GAP_DAYS[1]) for gap in gaps):
        return fallback("los trimestres disponibles no son consecutivos.")

    cashflow_periods = sorted_periods(quarterly_cashflow)
    if not cashflow_periods:
        return fallback("no hay cash flow trimestral.")

    if not is_empty(quarterly_balance):
        balance_frame = quarterly_balance
        balance_period = sorted_periods(quarterly_balance)[-1]
    else:
        balance_frame = annual_balance
        balance_periods = sorted_periods(annual_balance)
        balance_period = balance_periods[-1] if balance_periods else None

    items = []
    for period in last_four:
        cashflow_period = nearest_period(cashflow_periods, period, QUARTER_MATCH_DAYS)
        if cashflow_period is None:
            return fallback(f"falta el cash flow del trimestre {period:%Y-%m}.")
        item = compose_period(
            period, quarterly_income, balance_frame, quarterly_cashflow, balance_period, cashflow_period
        )
        if item["revenue"] <= 0:
            return fallback(f"el trimestre {period:%Y-%m} no tiene ventas publicadas.")
        items.append(item)
    return add_periods(items, "LTM"), []


def normalize_quote(price: float, currency: str) -> tuple[float, str]:
    """Pasa cotizaciones en subunidades (GBp, ZAc, ILA) a la moneda principal."""
    if currency in SUBUNIT_CURRENCIES:
        main, divisor = SUBUNIT_CURRENCIES[currency]
        return price / divisor, main
    return price, currency
