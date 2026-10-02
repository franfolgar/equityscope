# Cambios respecto al repo original

## Errores corregidos (cambian resultados)
- **Deuda neta:** sumaba la caja; ahora la resta (`valuation.ts`). Afecta a deuda neta/EBITDA, a las alertas, al puente EV→precio y a los múltiplos EV.
- **Deuda neta proyectada:** era un múltiplo fijo del EBITDA; ahora baja con el FCF de cada año.
- **Métodos de valoración inaplicables:** un método con base ≤ 0 o precio ≤ 0 ya no entra en la media (antes podía salir un objetivo negativo). Los múltiplos sin base positiva son `n/a`, no 0 ni negativos.
- **Variación de circulante proyectada:** ahora `% × incremento de ventas` (antes `% × ventas × crecimiento`, que la sobrestimaba).
- **Alias con NaN (`statement_value`):** si la primera etiqueta de Yahoo existía pero era NaN, devolvía 0; ahora prueba la siguiente.
- **LTM:** el cash flow trimestral se emparejaba con el trimestre más cercano sin límite (duplicaba CapEx y D&A). Ahora hay tolerancia de 20 días y, si no es fiable, se cae al último anual con aviso.
- **Moneda:** `GBp`/`ZAc`/`ILA` se normalizan a la moneda principal; si la moneda de los estados difiere de la de cotización, el precio se convierte (o se avisa).
- **Participaciones minoritarias:** se buscan también con la etiqueta del estado de resultados (`Minority Interests`).

## Modelo
- «Valoración general» compara el CAGR con un retorno exigido editable (antes: potencial > 0).
- CAGR propio por método (antes la misma cifra en las cuatro filas).
- Valores por defecto más prudentes: crecimiento acotado y con convergencia, tasa fiscal sin años con pérdidas y acotada, múltiplos de partida basados en los de la empresa, crecimiento de acciones acotado.
- Alerta de apalancamiento también con EBITDA ≤ 0; el primer año (sin variación de circulante) no cuenta como FCF negativo.

## Backend
- Módulos `statements.py` (lógica pura), `service.py`, `cache.py`, `ratelimit.py`; `main.py` queda como capa HTTP.
- Caché TTL, límite de peticiones por IP y global, límite de concurrencia hacia Yahoo, precio vía `fast_info`.
- Los errores inesperados ya no exponen el texto de la excepción.
- `render.yaml`: `PYTHON_VERSION` fijada y variables opcionales documentadas.

## Frontend
- Los inputs numéricos permiten borrar y reescribir; el valor se acota a [min, max].
- «Probar con AAPL» usa el símbolo correcto; las consultas se cancelan si llega otra (`AbortController`).
- Avisos del API visibles; n/a en lugar de ceros engañosos; pestañas con `tabpanel`; «Metodología» enlaza a su tarjeta.
- Eliminado código muerto: `src/App.css`, `src/assets/*`, `public/icons.svg`.

## Calidad
- 31 tests del frontend (`node:test`, sin dependencias nuevas) y 40 del backend (`unittest`).
- Nuevo `ci.yml` (lint + tests + build); el despliegue a Pages ahora ejecuta los tests antes de compilar.
