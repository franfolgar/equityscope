import unittest

import numpy as np
import pandas as pd

from backend.statements import (
    ALIASES,
    add_periods,
    build_annual,
    build_ltm,
    compose_period,
    lookup,
    nearest_period,
    normalize_quote,
    statement_value,
)
from tests.backend.helpers import (
    ANNUAL_DATES,
    QUARTER_DATES,
    balance_frame,
    cashflow_frame,
    frame,
    income_frame,
)

P = pd.Timestamp("2024-12-31")


class StatementValueTests(unittest.TestCase):
    def test_skips_alias_whose_value_is_nan(self):
        # Fallo original: devolvía 0.0 porque la primera etiqueta existía (con NaN).
        df = frame({"Interest Expense Non Operating": [np.nan], "Interest Expense": [123.0]}, ["2024-12-31"])
        self.assertEqual(statement_value(df, ALIASES["interestExpense"], P), 123.0)

    def test_prefers_first_finite_alias(self):
        df = frame({"Total Revenue": [10.0], "Operating Revenue": [99.0]}, ["2024-12-31"])
        self.assertEqual(statement_value(df, ALIASES["revenue"], P), 10.0)

    def test_missing_everything_is_zero_in_value_and_none_in_lookup(self):
        df = frame({"Other": [1.0]}, ["2024-12-31"])
        self.assertIsNone(lookup(df, ALIASES["revenue"], P))
        self.assertEqual(statement_value(df, ALIASES["revenue"], P), 0.0)

    def test_none_frame_or_period(self):
        self.assertEqual(statement_value(None, ALIASES["revenue"], P), 0.0)
        df = frame({"Total Revenue": [5.0]}, ["2024-12-31"])
        self.assertEqual(statement_value(df, ALIASES["revenue"], None), 0.0)

    def test_minority_interest_accepts_income_statement_label(self):
        df = frame({"Minority Interests": [-7.0]}, ["2024-12-31"])
        self.assertEqual(statement_value(df, ALIASES["minorityInterest"], P), -7.0)


class NearestPeriodTests(unittest.TestCase):
    def test_returns_none_beyond_tolerance(self):
        cash = [pd.Timestamp(d) for d in QUARTER_DATES[1:]]  # falta el primer trimestre
        self.assertIsNone(nearest_period(cash, pd.Timestamp("2024-03-31"), 20))

    def test_returns_match_within_tolerance(self):
        cash = [pd.Timestamp("2024-04-05")]
        self.assertEqual(nearest_period(cash, pd.Timestamp("2024-03-31"), 20), cash[0])

    def test_empty(self):
        self.assertIsNone(nearest_period([], P, 20))


class ComposePeriodTests(unittest.TestCase):
    def test_builds_ebitda_and_signs(self):
        inc = income_frame(["2024-12-31"])
        bal = balance_frame(["2024-12-31"])
        cf = cashflow_frame(["2024-12-31"], capex=[-30.0])
        item = compose_period(P, inc, bal, cf, P, P)
        self.assertEqual(item["period"], "2024")
        self.assertEqual(item["ebitda"], 250.0)  # 200 EBIT + 50 D&A
        self.assertEqual(item["capex"], 30.0)  # el CapEx de Yahoo es negativo
        self.assertIsNone(item["changeInWorkingCapital"])

    def test_missing_cashflow_period_gives_zero_capex(self):
        item = compose_period(P, income_frame(["2024-12-31"]), balance_frame(["2024-12-31"]), None, P, None)
        self.assertEqual(item["capex"], 0.0)
        self.assertEqual(item["depreciation"], 0.0)


class BuildAnnualTests(unittest.TestCase):
    def test_four_years_and_no_warnings(self):
        annual, warnings = build_annual(
            income_frame(ANNUAL_DATES), balance_frame(ANNUAL_DATES), cashflow_frame(ANNUAL_DATES)
        )
        self.assertEqual([a["period"] for a in annual], ["2021", "2022", "2023", "2024"])
        self.assertEqual(warnings, [])

    def test_skips_columns_without_revenue(self):
        inc = income_frame(ANNUAL_DATES)
        inc.loc["Total Revenue", pd.Timestamp("2021-12-31")] = np.nan
        annual, _ = build_annual(inc, balance_frame(ANNUAL_DATES), cashflow_frame(ANNUAL_DATES))
        self.assertEqual([a["period"] for a in annual], ["2022", "2023", "2024"])

    def test_warns_when_balance_is_missing_for_a_year(self):
        annual, warnings = build_annual(
            income_frame(ANNUAL_DATES), balance_frame(ANNUAL_DATES[1:]), cashflow_frame(ANNUAL_DATES)
        )
        self.assertEqual(len(annual), 4)
        self.assertTrue(any("2021" in w and "balance" in w for w in warnings))


class BuildLtmTests(unittest.TestCase):
    def setUp(self):
        self.annual, _ = build_annual(
            income_frame(ANNUAL_DATES), balance_frame(ANNUAL_DATES), cashflow_frame(ANNUAL_DATES)
        )
        self.q_income = income_frame(QUARTER_DATES, revenue=300.0, **{"Operating Income": [60.0] * 4})
        self.q_balance = balance_frame(QUARTER_DATES)

    def test_sums_last_four_quarters(self):
        q_cash = cashflow_frame(QUARTER_DATES, capex=[-10.0, -20.0, -30.0, -40.0])
        ltm, warnings = build_ltm(self.annual, self.q_income, self.q_balance, q_cash, balance_frame(ANNUAL_DATES))
        self.assertEqual(warnings, [])
        self.assertEqual(ltm["period"], "LTM")
        self.assertEqual(ltm["revenue"], 1200.0)
        self.assertEqual(ltm["ebit"], 240.0)
        self.assertEqual(ltm["capex"], 100.0)
        self.assertEqual(ltm["depreciation"], 200.0)
        self.assertEqual(ltm["ebitda"], 440.0)
        self.assertEqual(ltm["dilutedShares"], 100.0)  # no se suman las acciones

    def test_missing_cashflow_quarter_falls_back_instead_of_double_counting(self):
        # Fallo original: el T1 se emparejaba con el T2 y duplicaba CapEx y D&A.
        q_cash = cashflow_frame(QUARTER_DATES[1:], capex=[-20.0, -30.0, -40.0])
        ltm, warnings = build_ltm(self.annual, self.q_income, self.q_balance, q_cash, balance_frame(ANNUAL_DATES))
        self.assertEqual(ltm["period"], "LTM*")
        self.assertEqual(ltm["revenue"], self.annual[-1]["revenue"])
        self.assertEqual(len(warnings), 1)
        self.assertIn("cash flow", warnings[0])

    def test_fewer_than_four_quarters_falls_back(self):
        ltm, warnings = build_ltm(
            self.annual,
            income_frame(QUARTER_DATES[1:], revenue=300.0),
            self.q_balance,
            cashflow_frame(QUARTER_DATES),
            balance_frame(ANNUAL_DATES),
        )
        self.assertEqual(ltm["period"], "LTM*")
        self.assertEqual(len(warnings), 1)

    def test_non_consecutive_quarters_fall_back(self):
        dates = ["2023-03-31", "2024-06-30", "2024-09-30", "2024-12-31"]
        ltm, warnings = build_ltm(
            self.annual,
            income_frame(dates, revenue=300.0),
            balance_frame(dates),
            cashflow_frame(dates),
            balance_frame(ANNUAL_DATES),
        )
        self.assertEqual(ltm["period"], "LTM*")
        self.assertIn("consecutivos", warnings[0])

    def test_quarter_without_revenue_falls_back(self):
        q_income = income_frame(QUARTER_DATES, revenue=300.0)
        q_income.loc["Total Revenue", pd.Timestamp("2024-06-30")] = np.nan
        ltm, warnings = build_ltm(
            self.annual, q_income, self.q_balance, cashflow_frame(QUARTER_DATES), balance_frame(ANNUAL_DATES)
        )
        self.assertEqual(ltm["period"], "LTM*")
        self.assertIn("ventas", warnings[0])

    def test_fallback_does_not_mutate_annual_period(self):
        ltm, _ = build_ltm(self.annual, pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), balance_frame(ANNUAL_DATES))
        self.assertEqual(self.annual[-1]["period"], "2024")
        self.assertEqual(ltm["period"], "LTM*")


class AddPeriodsTests(unittest.TestCase):
    def test_working_capital_change_is_left_to_the_frontend(self):
        base = compose_period(P, income_frame(["2024-12-31"]), balance_frame(["2024-12-31"]), None, P, None)
        self.assertIsNone(add_periods([base, base], "LTM")["changeInWorkingCapital"])


class NormalizeQuoteTests(unittest.TestCase):
    def test_pence_to_pounds(self):
        self.assertEqual(normalize_quote(2450.0, "GBp"), (24.5, "GBP"))

    def test_other_subunits(self):
        self.assertEqual(normalize_quote(1000.0, "ZAc"), (10.0, "ZAR"))
        self.assertEqual(normalize_quote(500.0, "ILA"), (5.0, "ILS"))

    def test_regular_currency_untouched(self):
        self.assertEqual(normalize_quote(10.0, "EUR"), (10.0, "EUR"))
        self.assertEqual(normalize_quote(10.0, "GBP"), (10.0, "GBP"))


if __name__ == "__main__":
    unittest.main()
