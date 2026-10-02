"""Datos sintéticos con la forma de los DataFrames de yfinance."""

from __future__ import annotations

import pandas as pd

ANNUAL_DATES = ["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31"]
QUARTER_DATES = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"]


def frame(rows: dict[str, list[float]], dates: list[str]) -> pd.DataFrame:
    """Filas = etiquetas de Yahoo; columnas = fechas (como yfinance)."""
    return pd.DataFrame(rows, index=[pd.Timestamp(d) for d in dates]).T


def income_frame(dates: list[str], revenue: float = 1000.0, **overrides: list[float]) -> pd.DataFrame:
    n = len(dates)
    rows = {
        "Total Revenue": [revenue] * n,
        "Operating Income": [200.0] * n,
        "Interest Expense": [10.0] * n,
        "Interest Income Non Operating": [2.0] * n,
        "Tax Provision": [40.0] * n,
        "Net Income": [150.0] * n,
        "Diluted Average Shares": [100.0] * n,
        "Minority Interests": [0.0] * n,
    }
    rows.update(overrides)
    return frame(rows, dates)


def balance_frame(dates: list[str]) -> pd.DataFrame:
    n = len(dates)
    return frame(
        {
            "Cash And Cash Equivalents": [300.0] * n,
            "Long Term Debt": [150.0] * n,
            "Current Debt": [50.0] * n,
            "Stockholders Equity": [500.0] * n,
            "Inventory": [100.0] * n,
            "Accounts Receivable": [80.0] * n,
            "Accounts Payable": [60.0] * n,
        },
        dates,
    )


def cashflow_frame(dates: list[str], capex: list[float] | None = None) -> pd.DataFrame:
    n = len(dates)
    return frame(
        {
            "Depreciation And Amortization": [50.0] * n,
            "Capital Expenditure": capex if capex is not None else [-30.0] * n,
        },
        dates,
    )


class FakeHistory:
    """Mínimo de DataFrame para ``history()['Close']``."""

    def __init__(self, closes: list[float]) -> None:
        self._closes = closes

    def __getitem__(self, key: str) -> pd.Series:
        assert key == "Close"
        return pd.Series(self._closes, dtype="float64")


class FakeTicker:
    def __init__(
        self,
        *,
        info: dict | None = None,
        fast_price: float | None = 25.0,
        history_closes: list[float] | None = None,
        empty: bool = False,
        quarterly_cashflow: pd.DataFrame | None = None,
        raise_on_financials: Exception | None = None,
    ) -> None:
        self._info = info if info is not None else {"currency": "USD", "financialCurrency": "USD", "longName": "Test Inc."}
        self._fast = {"last_price": fast_price} if fast_price is not None else {}
        self._history = history_closes or []
        self._raise = raise_on_financials
        empty_frame = pd.DataFrame()
        self._empty = empty
        self._q_cash = quarterly_cashflow
        self._empty_frame = empty_frame

    @property
    def fast_info(self) -> dict:
        return self._fast

    def get_info(self) -> dict:
        return self._info

    def history(self, **_: object) -> FakeHistory:
        return FakeHistory(self._history)

    @property
    def financials(self) -> pd.DataFrame:
        if self._raise:
            raise self._raise
        return self._empty_frame if self._empty else income_frame(ANNUAL_DATES)

    @property
    def balance_sheet(self) -> pd.DataFrame:
        return self._empty_frame if self._empty else balance_frame(ANNUAL_DATES)

    @property
    def cashflow(self) -> pd.DataFrame:
        return cashflow_frame(ANNUAL_DATES)

    @property
    def quarterly_financials(self) -> pd.DataFrame:
        return income_frame(QUARTER_DATES, revenue=300.0, **{"Operating Income": [60.0] * 4})

    @property
    def quarterly_balance_sheet(self) -> pd.DataFrame:
        return balance_frame(QUARTER_DATES)

    @property
    def quarterly_cashflow(self) -> pd.DataFrame:
        if self._q_cash is not None:
            return self._q_cash
        return cashflow_frame(QUARTER_DATES, capex=[-10.0] * 4)


def factory_for(main: FakeTicker, fx: dict[str, list[float]] | None = None):
    """Fábrica de tickers: el principal y, opcionalmente, pares FX como EURUSD=X."""

    def make(symbol: str) -> FakeTicker:
        if symbol.endswith("=X"):
            if fx is None or symbol not in fx:
                raise RuntimeError("sin datos FX")
            return FakeTicker(history_closes=fx[symbol])
        return main

    return make
