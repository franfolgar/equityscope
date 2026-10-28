@AGENTS.md

# EquityScope

Análisis y valoración de acciones. Frontend React + Vite + TypeScript + Tailwind + Recharts (`src/`). Proxy de datos FastAPI + yfinance (`backend/`) con caché, límite de peticiones y concurrencia limitada.

## Comandos
- Frontend: `npm install` · `npm run dev` · `npm run build` · `npm run lint` (oxlint)
- Backend: `python -m venv .venv` → `pip install -r backend/requirements-test.txt` → `npm run api` (uvicorn en el puerto 8000)
- Tests: `npm test` (= `test:web` con Node 22 `--test` + `test:api` con unittest)

## Configuración
`.env` (no versionado; plantilla en `.env.example`): `VITE_API_URL`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `GLOBAL_RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY_HOPS`, `UPSTREAM_CONCURRENCY`, `UPSTREAM_HTTP_TIMEOUT`, `CACHE_TTL_SECONDS`.

## Despliegue
- Frontend: GitHub Pages (`.github/workflows/deploy.yml`) en cada push a `main`.
- API: Render (`render.yaml`, servicio `equityscope-api-franfolgar`, autoDeploy).
- CI (`ci.yml`): lint, tests y build en cada push y PR.

## Notas
- Auditoría de rendimiento y cuelgues hecha en Antigravity: `docs/auditoria-rendimiento.md` (semáforo en `backend/service.py`, cómputo redundante en el frontend). Comprueba qué está ya corregido antes de retomarla.
- Repo **público**.
