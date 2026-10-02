from __future__ import annotations

import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .ratelimit import SlidingWindowLimiter, allow_analysis_request
from .service import DataError, get_company

app = FastAPI(title="EquityScope Finance API", version="1.1.0")
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


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# Límite por IP y límite global (protege a Yahoo y al plan gratuito de Render).
per_ip_limiter = SlidingWindowLimiter(_env_int("RATE_LIMIT_PER_MINUTE", 30))
global_limiter = SlidingWindowLimiter(_env_int("GLOBAL_RATE_LIMIT_PER_MINUTE", 240))
# Número de proxies de confianza delante de la app: se toma la entrada de
# X-Forwarded-For que añadió el último de ellos (la del cliente puede falsearse).
TRUST_PROXY_HOPS = _env_int("TRUST_PROXY_HOPS", 1)


def client_ip(request: Request) -> str:
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if forwarded and TRUST_PROXY_HOPS > 0:
        return forwarded[max(0, len(forwarded) - TRUST_PROXY_HOPS)]
    return request.client.host if request.client else "unknown"


@app.get("/api/analysis/{symbol}")
def analyze(symbol: str, request: Request) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9.^=-]{1,15}", symbol):
        raise HTTPException(status_code=400, detail="Ticker no válido.")
    if not allow_analysis_request(per_ip_limiter, global_limiter, client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail="Demasiadas consultas; espera un minuto e inténtalo de nuevo.",
            headers={"Retry-After": "60"},
        )
    try:
        return get_company(symbol.upper())
    except DataError as error:
        raise HTTPException(status_code=error.status_code, detail=error.detail) from error


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
