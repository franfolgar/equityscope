from __future__ import annotations

import math
import os
import re
from datetime import date
from typing import Any

import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="EquityScope Finance API", version="1.0.0")
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

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
    "minorityInterest": ("Minority Interest",),
}


def finite_number(value: Any) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else 0.0
    except (TypeError, ValueError):
        return 0.0


def statement_value(frame: Any, aliases: tuple[str, ...], period: Any) -> float:
    if frame is None or getattr(frame, "empty", True):
        return 0.0
    for label in aliases:
        if label in frame.index and period in frame.columns:
            return finite_number(frame.at[label, period])
    return 0.0


def sorted_periods(frame: Any) -> list[Any]:
    if frame is None or getattr(frame, "empty", True):
        return []
    return sorted(frame.columns, key=lambda item: str(item))


def format_period(period: Any) -> str:
    if hasattr(period, "strftime"):
        return period.strftime("%Y")
    return str(period)[:4]


def compose_period(
    period: Any,
    income: Any,
    balance: Any,
    cashflow: Any,
    balance_period: Any,
) -> dict[str, Any]:
    def value(key: str, source: Any = None, source_period: Any = None) -> float:
        frame = source if source is not None else income
        selected_period = source_period if source_period is not None else period
        return statement_value(frame, ALIASES[key], selected_period)

    ebit = value("ebit")
    depreciation = abs(value("depreciation", cashflow))
    income_revenue = value("revenue")
    if not income_revenue:
        income_revenue = value("revenue", cashflow)
    return {
        "period": format_period(period),
        "revenue": income_revenue,
        "ebit": ebit,
        "depreciation": depreciation,
        "ebitda": ebit + depreciation,
        "interestExpense": abs(value("interestExpense")),
        "interestIncome": value("interestIncome"),
        "taxExpense": abs(value("taxExpense")),
        "netIncome": value("netIncome"),
        "dilutedShares": value("dilutedShares"),
        "cash": value("cash", balance, balance_period),
        "shortTermInvestments": value("shortTermInvestments", balance, balance_period),
        "shortTermDebt": value("shortTermDebt", balance, balance_period),
        "longTermDebt": value("longTermDebt", balance, balance_period),
        "currentLease": value("currentLease", balance, balance_period),
        "longTermLease": value("longTermLease", balance, balance_period),
        "equity": value("equity", balance, balance_period),
        "inventory": value("inventory", balance, balance_period),
        "receivables": value("receivables", balance, balance_period),
        "payables": value("payables", balance, balance_period),
        "unearnedRevenue": value("unearnedRevenue", balance, balance_period),
        "capex": abs(value("capex", cashflow)),
        "changeInWorkingCapital": 0.0,
        "minorityInterest": value("minorityInterest"),
    }


def add_periods(periods: list[dict[str, Any]], label: str) -> dict[str, Any]:
    result = dict(periods[-1])
    result["period"] = label
    additive = (
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
    for key in additive:
        result[key] = sum(period[key] for period in periods)
    result["dilutedShares"] = periods[-1]["dilutedShares"]
    return result


def get_ticker_data(symbol: str) -> dict[str, Any]:
    try:
        ticker = yf.Ticker(symbol)
        income = ticker.financials
        balance = ticker.balance_sheet
        cashflow = ticker.cashflow
        income_periods = sorted_periods(income)
        balance_periods = sorted_periods(balance)
        cashflow_periods = sorted_periods(cashflow)

        if not income_periods or not balance_periods:
            raise HTTPException(
                status_code=404,
                detail=f"Yahoo Finance no publica estados financieros suficientes para {symbol}.",
            )

        annual = []
        for period in income_periods[-5:]:
            matching_balance = min(balance_periods, key=lambda item: abs((item - period).days))
            matching_cashflow = min(cashflow_periods, key=lambda item: abs((item - period).days)) if cashflow_periods else period
            annual_period = compose_period(period, income, balance, cashflow, matching_balance)
            annual_period["capex"] = abs(statement_value(cashflow, ALIASES["capex"], matching_cashflow))
            annual_period["depreciation"] = abs(statement_value(cashflow, ALIASES["depreciation"], matching_cashflow))
            annual_period["ebitda"] = annual_period["ebit"] + annual_period["depreciation"]
            if annual_period["revenue"] > 0:
                annual.append(annual_period)

        if not annual:
            raise HTTPException(
                status_code=404,
                detail=f"Yahoo Finance no publica ingresos anuales utilizables para {symbol}.",
            )

        quarterly_income = ticker.quarterly_financials
        quarterly_cashflow = ticker.quarterly_cashflow
        quarterly_balance = ticker.quarterly_balance_sheet
        quarter_periods = sorted_periods(quarterly_income)
        quarter_balance_periods = sorted_periods(quarterly_balance)
        quarter_cashflow_periods = sorted_periods(quarterly_cashflow)

        if len(quarter_periods) >= 4:
            last_quarters = quarter_periods[-4:]
            latest_balance_period = quarter_balance_periods[-1] if quarter_balance_periods else balance_periods[-1]
            ltm_quarters = []
            for period in last_quarters:
                matching_cf = min(quarter_cashflow_periods, key=lambda item: abs((item - period).days)) if quarter_cashflow_periods else period
                ltm_quarters.append(compose_period(period, quarterly_income, quarterly_balance, quarterly_cashflow, latest_balance_period))
                ltm_quarters[-1]["capex"] = abs(statement_value(quarterly_cashflow, ALIASES["capex"], matching_cf))
                ltm_quarters[-1]["depreciation"] = abs(statement_value(quarterly_cashflow, ALIASES["depreciation"], matching_cf))
                ltm_quarters[-1]["ebitda"] = ltm_quarters[-1]["ebit"] + ltm_quarters[-1]["depreciation"]
            ltm = add_periods(ltm_quarters, "LTM")
        else:
            ltm = dict(annual[-1])
            ltm["period"] = "LTM*"

        try:
            info = ticker.get_info()
        except Exception:
            info = {}
        price = finite_number(info.get("currentPrice") or info.get("regularMarketPrice"))
        if price <= 0:
            history = ticker.history(period="5d", auto_adjust=False)
            if not history.empty:
                price = finite_number(history["Close"].dropna().iloc[-1])
        if ltm["dilutedShares"] <= 0:
            ltm["dilutedShares"] = finite_number(info.get("sharesOutstanding"))
        for period in annual:
            if period["dilutedShares"] <= 0:
                period["dilutedShares"] = ltm["dilutedShares"]
        if price <= 0:
            raise HTTPException(status_code=404, detail=f"No se encontró una cotización reciente para {symbol}.")

        return {
            "ticker": symbol,
            "name": str(info.get("longName") or info.get("shortName") or symbol),
            "currency": str(info.get("currency") or "USD"),
            "price": price,
            "periods": annual,
            "ltm": ltm,
            "source": "Yahoo Finance (yfinance)",
            "asOf": date.today().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"No se pudieron obtener los datos de {symbol} desde Yahoo Finance: {error}",
        ) from error


@app.get("/api/analysis/{symbol}")
def analyze(symbol: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9.^=-]{1,15}", symbol):
        raise HTTPException(status_code=400, detail="Ticker no válido.")
    return get_ticker_data(symbol.upper())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
