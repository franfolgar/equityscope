import unittest

from backend.service import DataError, fetch_company, search_tickers
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

    def test_response_includes_provenance_and_missing_metrics(self):
        info = {
            "currency": "USD",
            "financialCurrency": "USD",
            "regularMarketTime": 1_728_000_000,
        }
        data = fetch_company("TEST", factory_for(FakeTicker(info=info)))
        self.assertEqual(data["source"], "Yahoo Finance (yfinance)")
        self.assertEqual(data["statementPeriod"], "2024")
        self.assertRegex(data["fetchedAt"], r"\+00:00$")
        self.assertEqual(data["quoteAsOf"], "2024-10-04T00:00:00+00:00")
        self.assertIn("Inversiones a corto plazo", data["missingMetrics"])
        self.assertNotIn("Ingresos", data["missingMetrics"])


class SearchTickersTests(unittest.TestCase):
    def test_search_maps_equities_and_filters_non_equity_results(self):
        calls = []

        class Result:
            quotes = [
                {
                    "symbol": "IBE.MC",
                    "quoteType": "EQUITY",
                    "longname": "Iberdrola, S.A.",
                    "exchDisp": "Madrid Stock Exchange",
                },
                {"symbol": "IBE.MC", "quoteType": "EQUITY", "shortname": "Duplicate"},
                {"symbol": "^IBEX", "quoteType": "INDEX", "shortname": "IBEX 35"},
                {"symbol": "BAD SYMBOL", "quoteType": "EQUITY", "shortname": "Invalid"},
            ]

        def factory(query):
            calls.append(query)
            return Result()

        first = search_tickers("Iberdrola", factory)
        second = search_tickers("Iberdrola", factory)
        self.assertEqual(first, [{
            "ticker": "IBE.MC",
            "name": "Iberdrola, S.A.",
            "market": "Madrid Stock Exchange",
        }])
        self.assertEqual(second, first)
        self.assertEqual(calls, ["Iberdrola"])

    def test_market_filter_keeps_only_listings_on_selected_exchange(self):
        class Result:
            quotes = [
                {
                    "symbol": "IBE.MC",
                    "quoteType": "EQUITY",
                    "longname": "Iberdrola, S.A.",
                    "exchange": "MCE",
                    "exchDisp": "Madrid Stock Exchange",
                },
                {
                    "symbol": "IBDRY",
                    "quoteType": "EQUITY",
                    "longname": "Iberdrola ADR",
                    "exchange": "PNK",
                    "exchDisp": "OTC Markets",
                },
            ]

        results = search_tickers("Iberdrola", lambda _: Result(), market="spain")
        self.assertEqual([item["ticker"] for item in results], ["IBE.MC"])

    def test_market_only_search_uses_exchange_screener(self):
        def screener(market):
            self.assertEqual(market, "spain")
            return {
                "quotes": [{
                    "symbol": "SAN.MC",
                    "quoteType": "EQUITY",
                    "longName": "Banco Santander, S.A.",
                    "exchange": "MCE",
                }]
            }

        results = search_tickers("", market_factory=screener, market="spain")
        self.assertEqual(results, [{
            "ticker": "SAN.MC",
            "name": "Banco Santander, S.A.",
            "market": "España · Bolsa de Madrid",
        }])

    def test_search_rejects_missing_market_and_oversized_queries(self):
        with self.assertRaises(DataError) as empty:
            search_tickers(" ")
        self.assertEqual(empty.exception.status_code, 400)
        with self.assertRaises(DataError) as long:
            search_tickers("x" * 81)
        self.assertEqual(long.exception.status_code, 400)
        with self.assertRaises(DataError) as invalid_market:
            search_tickers("Apple", market="not-a-market")
        self.assertEqual(invalid_market.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
