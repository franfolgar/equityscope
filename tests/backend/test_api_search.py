import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app


class SearchEndpointTests(unittest.TestCase):
    def test_search_returns_company_market_results(self):
        expected = [{
            "ticker": "IBE.MC",
            "name": "Iberdrola, S.A.",
            "market": "Madrid Stock Exchange CATS",
        }]
        with patch("backend.main.search_tickers", return_value=expected) as search:
            response = TestClient(app).get("/api/search", params={"q": "Iberdrola"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        search.assert_called_once_with("Iberdrola", market=None)

    def test_search_rejects_empty_query(self):
        response = TestClient(app).get("/api/search", params={"q": ""})
        self.assertEqual(response.status_code, 400)

    def test_market_only_search_is_supported(self):
        with patch("backend.main.search_tickers", return_value=[]) as search:
            response = TestClient(app).get("/api/search", params={"market": "spain"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        search.assert_called_once_with("", market="spain")

    def test_currency_conversion_returns_rate(self):
        expected = {
            "source": "EUR",
            "target": "USD",
            "rate": 1.1,
            "fetchedAt": "2026-10-08T07:00:00+00:00",
        }
        with patch("backend.main.get_conversion_rate", return_value=expected) as convert:
            response = TestClient(app).get("/api/currency/convert", params={"from": "EUR", "to": "USD"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        convert.assert_called_once_with("EUR", "USD")

    def test_currency_conversion_rejects_invalid_codes(self):
        response = TestClient(app).get("/api/currency/convert", params={"from": "EU1", "to": "USD"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
