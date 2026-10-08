import type { CompanyData, CompanySearchResult, CurrencyConversion } from './types'

const API_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? 'http://localhost:8000' : '')

const TICKER_PATTERN = /^[A-Z0-9.^=-]{1,15}$/

function isCompanyData(payload: unknown): payload is CompanyData {
  if (typeof payload !== 'object' || payload === null) return false
  const candidate = payload as Partial<CompanyData>
  return (
    typeof candidate.ticker === 'string' &&
    typeof candidate.price === 'number' &&
    Array.isArray(candidate.periods) &&
    candidate.periods.length > 0 &&
    typeof candidate.ltm === 'object' &&
    candidate.ltm !== null
  )
}

function isCompanySearchResult(value: unknown): value is CompanySearchResult {
  if (typeof value !== 'object' || value === null) return false
  return (
    'ticker' in value &&
    typeof value.ticker === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'market' in value &&
    typeof value.market === 'string'
  )
}

function isCurrencyConversion(value: unknown): value is CurrencyConversion {
  if (typeof value !== 'object' || value === null) return false
  return (
    'source' in value &&
    typeof value.source === 'string' &&
    'target' in value &&
    typeof value.target === 'string' &&
    'rate' in value &&
    typeof value.rate === 'number' &&
    Number.isFinite(value.rate) &&
    value.rate > 0 &&
    'fetchedAt' in value &&
    typeof value.fetchedAt === 'string'
  )
}

export async function fetchCompany(ticker: string, signal?: AbortSignal): Promise<CompanyData> {
  const symbol = ticker.trim().toUpperCase()
  if (!TICKER_PATTERN.test(symbol)) {
    throw new Error('Introduce un ticker válido (por ejemplo, AAPL o BRK-B).')
  }

  if (!API_URL) {
    throw new Error(
      'El API financiero todavía no está configurado para esta web. Despliega backend/ y añade su URL HTTPS como variable VITE_API_URL en Settings → Secrets and variables → Actions → Variables; después vuelve a ejecutar el workflow de GitHub Pages.',
    )
  }

  let response: Response
  try {
    response = await fetch(`${API_URL}/api/analysis/${encodeURIComponent(symbol)}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
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

  const payload: unknown = await response.json()
  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? (payload as { detail?: unknown }).detail
        : undefined
    if (response.status === 429) {
      throw new Error(typeof detail === 'string' ? detail : 'Demasiadas consultas; espera un minuto.')
    }
    throw new Error(typeof detail === 'string' && detail ? detail : `No se pudo analizar ${symbol}.`)
  }
  if (!isCompanyData(payload)) {
    throw new Error('El API respondió con JSON, pero no con el formato de datos financieros esperado.')
  }
  return payload
}

export async function searchCompanies(
  query: string,
  signal?: AbortSignal,
  market?: string,
): Promise<CompanySearchResult[]> {
  const normalized = query.trim()
  if (normalized.length > 80 || (!normalized && !market)) {
    throw new Error('Escribe un ticker/nombre o selecciona un mercado.')
  }
  if (!API_URL) {
    throw new Error('El buscador financiero no está configurado para esta web.')
  }

  let response: Response
  try {
    const params = new URLSearchParams({ q: normalized })
    if (market) params.set('market', market)
    response = await fetch(`${API_URL}/api/search?${params}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof TypeError) {
      throw new Error(`No se pudo conectar con el buscador financiero en ${API_URL}.`)
    }
    throw error
  }

  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`El buscador respondió con un formato no JSON (HTTP ${response.status}).`)
  }
  const payload: unknown = await response.json()
  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? (payload as { detail?: unknown }).detail
        : undefined
    throw new Error(typeof detail === 'string' && detail ? detail : 'No se pudo buscar empresas.')
  }
  if (!Array.isArray(payload) || !payload.every(isCompanySearchResult)) {
    throw new Error('El buscador respondió con resultados en un formato no válido.')
  }
  return payload
}

export async function fetchCurrencyConversion(
  source: string,
  target: string,
  signal?: AbortSignal,
): Promise<CurrencyConversion> {
  if (!/^[A-Z]{3}$/.test(source) || !/^[A-Z]{3}$/.test(target)) {
    throw new Error('Código de moneda no válido.')
  }
  if (source === target) {
    return { source, target, rate: 1, fetchedAt: new Date().toISOString() }
  }
  if (!API_URL) {
    throw new Error('El servicio de conversión de moneda no está configurado.')
  }

  let response: Response
  try {
    const params = new URLSearchParams({ from: source, to: target })
    response = await fetch(`${API_URL}/api/currency/convert?${params}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof TypeError) {
      throw new Error(`No se pudo conectar con el servicio de cambio en ${API_URL}.`)
    }
    throw error
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`El servicio de cambio respondió en un formato no JSON (HTTP ${response.status}).`)
  }
  const payload: unknown = await response.json()
  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload !== null && 'detail' in payload
        ? (payload as { detail?: unknown }).detail
        : undefined
    throw new Error(typeof detail === 'string' && detail ? detail : `No se pudo convertir ${source} a ${target}.`)
  }
  if (!isCurrencyConversion(payload) || payload.source !== source || payload.target !== target) {
    throw new Error('El servicio de cambio devolvió una respuesta no válida.')
  }
  return payload
}
