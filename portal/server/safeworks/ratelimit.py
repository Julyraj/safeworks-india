"""Simple in-process fixed-window rate limits (per server process)."""
from __future__ import annotations

import time

from .errors import HttpError


class Limiter:
    def __init__(self, window_seconds: int = 60):
        self.window = window_seconds
        self.hits: dict[str, tuple[float, int]] = {}

    def check(self, key: str, limit: int) -> None:
        now = time.time()
        start, n = self.hits.get(key, (now, 0))
        if now - start >= self.window:
            start, n = now, 0
        n += 1
        self.hits[key] = (start, n)
        if len(self.hits) > 100_000:
            cutoff = now - self.window
            self.hits = {k: v for k, v in self.hits.items() if v[0] >= cutoff}
        if n > limit:
            wait = int(self.window - (now - start)) + 1
            raise HttpError(429, f"Too many requests. Please wait {wait} seconds.", "rate_limited")


api_limiter = Limiter()
login_limiter = Limiter()
