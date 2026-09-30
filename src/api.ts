import type { CompanyData } from './types'

const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? 'http://localhost:8000' : '')

export async function fetchCompany(ticker: string): Promise<CompanyData> {
  const symbol = ticker.trim().toUpperCase()
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(symbol)) {
    throw new Error('Introduce un ticker válido (por ejemplo, AAPL o BRK-B).')
  }

  const response = await fetch(`${API_URL}/api/analysis/${encodeURIComponent(symbol)}`)
  const payload = (await response.json()) as CompanyData | { detail?: string }
  if (!response.ok) {
    const detail = 'detail' in payload ? payload.detail : undefined
    throw new Error(detail || `No se pudo analizar ${symbol}.`)
  }
  return payload as CompanyData
}
