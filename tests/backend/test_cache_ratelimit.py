import threading
import unittest

from backend.cache import TTLCache
from backend.ratelimit import SlidingWindowLimiter, allow_analysis_request


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class TTLCacheTests(unittest.TestCase):
    def test_expires_after_ttl(self):
        clock = Clock()
        cache = TTLCache(60, clock=clock)
        cache.set("a", 1)
        self.assertEqual(cache.get("a"), 1)
        clock.now += 61
        self.assertIsNone(cache.get("a"))

    def test_get_or_create_calls_factory_once(self):
        cache, calls = TTLCache(60), []
        for _ in range(3):
            self.assertEqual(cache.get_or_create("k", lambda: calls.append(1) or "v"), "v")
        self.assertEqual(len(calls), 1)

    def test_exceptions_are_not_cached(self):
        cache = TTLCache(60)

        def boom():
            raise ValueError("x")

        with self.assertRaises(ValueError):
            cache.get_or_create("k", boom)
        self.assertEqual(cache.get_or_create("k", lambda: "ok"), "ok")

    def test_concurrent_requests_share_a_single_fetch(self):
        cache, calls = TTLCache(60), []
        gate = threading.Event()

        def slow():
            calls.append(1)
            gate.wait(1)
            return "v"

        results = []
        threads = [threading.Thread(target=lambda: results.append(cache.get_or_create("k", slow))) for _ in range(5)]
        for t in threads:
            t.start()
        gate.set()
        for t in threads:
            t.join()
        self.assertEqual(results, ["v"] * 5)
        self.assertEqual(len(calls), 1)

    def test_bounded_size(self):
        cache = TTLCache(60, max_items=3)
        for i in range(10):
            cache.set(str(i), i)
        self.assertLessEqual(len(cache._items), 3)
        self.assertEqual(cache.get("9"), 9)


class LimiterTests(unittest.TestCase):
    def test_blocks_after_limit_and_recovers(self):
        clock = Clock()
        limiter = SlidingWindowLimiter(2, 60, clock=clock)
        self.assertTrue(limiter.allow("ip"))
        self.assertTrue(limiter.allow("ip"))
        self.assertFalse(limiter.allow("ip"))
        clock.now += 61
        self.assertTrue(limiter.allow("ip"))

    def test_keys_are_independent(self):
        limiter = SlidingWindowLimiter(1, 60)
        self.assertTrue(limiter.allow("a"))
        self.assertTrue(limiter.allow("b"))
        self.assertFalse(limiter.allow("a"))

    def test_ip_rejection_does_not_consume_global_quota(self):
        per_ip = SlidingWindowLimiter(1, 60)
        global_limiter = SlidingWindowLimiter(2, 60)
        self.assertTrue(allow_analysis_request(per_ip, global_limiter, "ip-a"))
        self.assertFalse(allow_analysis_request(per_ip, global_limiter, "ip-a"))
        self.assertTrue(allow_analysis_request(per_ip, global_limiter, "ip-b"))


if __name__ == "__main__":
    unittest.main()
