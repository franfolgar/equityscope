import unittest

from backend.service import DataError, fetch_company
from tests.backend.helpers import FakeTicker, QUARTER_DATES, cashflow_frame, factory_for


class FetchCompanyTests(unittest.TestCase):
    def test_happy_path(self):
        data = fetch_company("TEST", factory_for(FakeTicker()))
        self.assertEqual(data["ticker"], "TEST")
        self.assertEqual(data["name"], "Test Inc.")
        self.assertEqual(data["currency"], "USD")
        self.assertEqual(data["price"], 25.0)
        self.assertEqual(len(data["periods"]), 4)
        self.assertEqual(data["ltm"]["period"], "LTM")
        self.assertEqual(data["ltm"]["revenue"], 1200.0)
        self.assertEqual(data["warnings"], [])
        self.assertIsNone(data["ltm"]["changeInWorkingCapital"])

    def test_price_falls_back_to_info_then_history(self):
        info = {"currency": "USD", "financialCurrency": "USD", "currentPrice": 12.5}
        data = fetch_company("T", factory_for(FakeTicker(info=info, fast_price=None)))
        self.assertEqual(data["price"], 12.5)

        info = {"currency": "USD", "financialCurrency": "USD"}
        data = fetch_company("T", factory_for(FakeTicker(info=info, fast_price=None, history_closes=[9.0, 11.0])))
        self.assertEqual(data["price"], 11.0)

    def test_no_price_is_404(self):
        info = {"currency": "USD", "financialCurrency": "USD"}
        with self.assertRaises(DataError) as ctx:
            fetch_company("T", factory_for(FakeTicker(info=info, fast_price=None)))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_empty_statements_is_404(self):
        with self.assertRaises(DataError) as ctx:
            fetch_company("T", factory_for(FakeTicker(empty=True)))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_pence_quote_is_converted_to_pounds(self):
        info = {"currency": "GBp", "financialCurrency": "GBP", "longName": "Londres plc"}
        data = fetch_company("VOD.L", factory_for(FakeTicker(info=info, fast_price=2450.0)))
        self.assertEqual(data["currency"], "GBP")
        self.assertAlmostEqual(data["price"], 24.5)
        self.assertEqual(data["warnings"], [])

    def test_adr_price_is_converted_to_financial_currency(self):
        info = {"currency": "USD", "financialCurrency": "TWD", "longName": "ADR Co"}
        fx = {"TWDUSD=X": [0.030, 0.031]}  # 1 TWD = 0.031 USD
        data = fetch_company("ADR", factory_for(FakeTicker(info=info, fast_price=100.0), fx))
        self.assertEqual(data["currency"], "TWD")
        self.assertAlmostEqual(data["price"], 100.0 / 0.031)
        self.assertEqual(len(data["warnings"]), 1)
        self.assertIn("ADR", data["warnings"][0])

    def test_currency_mismatch_without_fx_keeps_price_and_warns(self):
        info = {"currency": "USD", "financialCurrency": "TWD"}
        data = fetch_company("ADR", factory_for(FakeTicker(info=info, fast_price=100.0), fx={}))
        self.assertEqual(data["currency"], "USD")
        self.assertEqual(data["price"], 100.0)
        self.assertIn("no se pudo convertir", data["warnings"][0])

    def test_ltm_fallback_surfaces_a_warning(self):
        q_cash = cashflow_frame(QUARTER_DATES[1:])
        data = fetch_company("T", factory_for(FakeTicker(quarterly_cashflow=q_cash)))
        self.assertEqual(data["ltm"]["period"], "LTM*")
        self.assertEqual(len(data["warnings"]), 1)

    def test_unexpected_errors_do_not_leak_internals(self):
        boom = RuntimeError("secreto: token=abc123")
        with self.assertRaises(DataError) as ctx:
            fetch_company("T", factory_for(FakeTicker(raise_on_financials=boom)))
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertNotIn("abc123", ctx.exception.detail)
        self.assertNotIn("secreto", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
