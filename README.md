# EquityScope

Aplicación de análisis y valoración de acciones con React, Vite, TypeScript, Tailwind CSS, Recharts y un proxy de datos Python con FastAPI/yfinance.

## Desarrollo local

Requisitos: Node.js 22 o superior y Python 3.10 o superior.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

En otra terminal:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

### Tests

```
npm run test:web   # lógica de valoración (Node 22+, sin dependencias extra)
npm run test:api   # extracción de estados, moneda, caché y límite de peticiones
npm test           # ambos
```

El CI (`.github/workflows/ci.yml`) ejecuta lint, tests y build en cada push y pull request.

La web usa `http://localhost:8000` por defecto cuando `VITE_API_URL` no está definido. Para usar otra URL, configura `VITE_API_URL` en `.env` y reinicia Vite. El endpoint de comprobación es `GET /health`; el análisis está en `GET /api/analysis/{ticker}`.

## Datos y cobertura

El proxy consulta Yahoo Finance mediante yfinance: hasta cinco períodos anuales de resultados, balance y flujo de caja, además de una estimación LTM sumando los últimos cuatro trimestres publicados. Las partidas no publicadas por Yahoo se representan como cero, por lo que conviene contrastar los estados con los informes de la empresa (si una etiqueta de Yahoo existe pero viene vacía, se prueba la siguiente equivalente). El precio de mercado puede retrasarse. Yahoo/yfinance no ofrece un SLA y puede limitar consultas.

El LTM solo se calcula si hay cuatro trimestres consecutivos con ventas y su cash flow se puede emparejar (±20 días); si no, se usa el último ejercicio anual (`LTM*`) y la web muestra un aviso. Las cotizaciones en subunidades (`GBp`, `ZAc`, `ILA`) se pasan a la moneda principal. Si la moneda de los estados (`financialCurrency`) difiere de la de cotización, el precio se convierte con el par de Yahoo (`EURUSD=X`…); en los ADR el ratio ADR/acción no se ajusta y se avisa. El API devuelve `warnings` con todo esto.

**Protección del API:** respuestas en caché 30 min por ticker, límite de 30 consultas/min por IP (y 240/min global), máximo 4 consultas simultáneas a Yahoo y errores genéricos hacia el cliente (el detalle va al log). Todo es configurable con variables de entorno (ver `render.yaml`).

GitHub Pages solo aloja el frontend estático; no ejecuta FastAPI. El archivo `render.yaml` permite crear el backend en Render como servicio Python gratuito:

1. Inicia sesión en Render, elige **New → Blueprint**, conecta `franfolgar/equityscope` y confirma la creación del servicio descrito por `render.yaml`.
2. Espera a que `https://equityscope-api-franfolgar.onrender.com/health` responda `{"status":"ok"}`. Si Render asigna otro subdominio, usa el que aparezca en el dashboard.
3. En **Settings → Secrets and variables → Actions → Variables** de GitHub, crea `VITE_API_URL` con el origen HTTPS del backend (sin `/api`).
4. En **Actions**, vuelve a ejecutar **Deploy to GitHub Pages** para compilar el frontend con ese origen.

Hasta que se configure el API, la página explica que el servicio falta en lugar de intentar interpretar la respuesta HTML de GitHub Pages como JSON. CORS permite el dominio de GitHub Pages y localhost para desarrollo. CORS solo limita solicitudes desde navegadores; no es autenticación y el API sigue siendo público.

El plan gratuito de Render puede suspender el servicio tras inactividad; la primera consulta puede tardar alrededor de un minuto al reactivarse. Es adecuado para pruebas y proyectos personales, no para producción.

## Modelo

Se ha seguido la plantilla IDC adjunta. Las cifras financieras se manejan en unidades de la moneda informada por Yahoo; la interfaz presenta las cifras de estados en millones.

- **EBITDA:** EBIT + depreciación y amortización. Márgenes EBIT y EBITDA: métrica / ventas.
- **Deuda neta:** deuda a corto + deuda a largo − caja − inversiones a corto plazo. Los arrendamientos no se incluyen (entran solo en el capital invertido).
- **Capital circulante:** inventarios + cuentas por cobrar − cuentas por pagar − ingresos diferidos. La variación del primer ejercicio no se puede calcular (sin balance previo) y se excluye de las alertas de FCF.
- **FCF:** EBITDA − CapEx de mantenimiento − intereses netos − impuestos − variación del capital circulante + intereses minoritarios. Los importes de CapEx, intereses e impuestos se normalizan a gastos positivos antes de restarlos. Yahoo no clasifica CapEx de mantenimiento y expansión por separado: se aproxima usando el CapEx reportado.
- **ROIC:** [EBIT × (1 − tasa fiscal)] / capital invertido. Capital invertido: patrimonio + deuda + arrendamientos − valores negociables.
- **Proyecciones:** ventas, D&A, CapEx y capital circulante crecen según supuestos editables; EBIT usa el margen proyectado. El crecimiento de ventas converge linealmente del valor del año 1 al del año 5. La variación de circulante es `% circulante/ventas × incremento de ventas`. La deuda neta evoluciona restando el FCF de cada año (dividendos y recompras no están modelados, así que en empresas que reparten mucho el modelo sobrestima la caja acumulada). Los supuestos de crecimiento y múltiplos son escenarios del usuario, no previsiones de consenso.
- **Supuestos por defecto:** crecimiento histórico acotado a ±20 % (y convergencia al 3 % si es mayor); tasa fiscal media de los años con beneficio, acotada a 0–35 %; múltiplos objetivo iguales a los actuales de la empresa acotados a 8x–30x (20/20/15/18 si no hay base positiva).
- **Precio objetivo:** media simple, al año 5 y por acción diluida, de los métodos aplicables entre PER ex-caja, EV/FCF, EV/EBITDA y EV/EBIT. Un método no aplica (n/a) si su base (beneficio, FCF, EBITDA o EBIT) no es positiva o si da un precio no positivo. Sin ningún método aplicable no hay precio objetivo. CAGR: (objetivo año 5 / precio actual)^(1/5) − 1, y también por método.
- **Valoración general:** compara el CAGR con el retorno anual exigido (10 % por defecto, editable): ≥ exigido «Infravalorada»; entre 0 y el exigido «Valoración ajustada»; negativo «Sobrevalorada».
- **Potencial etiquetado conforme al Excel como «margen de seguridad»:** precio objetivo EV/FCF / precio actual − 1. Es potencial de revalorización, no el margen de seguridad financiero convencional.
- **Alertas:** años con ventas decrecientes, margen EBIT decreciente, FCF negativo, ROIC < 10 %, deuda neta/EBITDA > 2,5x (también si el EBITDA no es positivo y hay deuda neta) y dilución observada (esta última es una mejora respecto de la plantilla).

La estimación LTM y los cálculos deben verificarse con los reportes publicados. Esto es una herramienta educativa, no asesoramiento financiero.

## GitHub Pages

El workflow `.github/workflows/deploy.yml` compila y publica `dist` al hacer push a `main` o al iniciarse manualmente. En GitHub, activa Pages con **GitHub Actions** como fuente. Para conectar el proxy desplegado, crea la variable de Actions `VITE_API_URL` con su origen público HTTPS y vuelve a ejecutar el workflow.
