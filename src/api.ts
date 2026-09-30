import type { CompanyData } from './types'

const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? 'http://localhost:8000' : '')

export async function fetchCompany(ticker: string): Promise<CompanyData> {
  const symbol = ticker.trim().toUpperCase()
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(symbol)) {
    throw new Error('Introduce un ticker válido (por ejemplo, AAPL o BRK-B).')
  }

  if (!API_URL) {
    throw new Error(
      'El API financiero todavía no está configurado para esta web. Despliega backend/ y añade su URL HTTPS como variable VITE_API_URL en Settings → Secrets and variables → Actions → Variables; después vuelve a ejecutar el workflow de GitHub Pages.',
    )
  }

  let response: Response
  try {
    response = await fetch(`${API_URL}/api/analysis/${encodeURIComponent(symbol)}`)
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `No se pudo conectar con el API financiero en ${API_URL}. Comprueba que el backend esté activo y permita solicitudes CORS desde esta web.`,
      )
    }
    throw error
  }

  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(
      `El API financiero respondió con un formato no JSON (HTTP ${response.status}). Comprueba que VITE_API_URL apunte al servicio FastAPI, no a la web de GitHub Pages.`,
    )
  }

  const payload = (await response.json()) as CompanyData | { detail?: string }
  if (!response.ok) {
    const detail = 'detail' in payload ? payload.detail : undefined
    throw new Error(detail || `No se pudo analizar ${symbol}.`)
  }
  if (!('ticker' in payload) || !('periods' in payload) || !('ltm' in payload)) {
    throw new Error('El API respondió con JSON, pero no con el formato de datos financieros esperado.')
  }
  return payload as CompanyData
}
