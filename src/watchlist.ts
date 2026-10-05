export interface WatchlistItem {
  ticker: string
  name: string
  market: string
}

export const WATCHLIST_STORAGE_KEY = 'equityscope.watchlist.v1'

export function parseWatchlist(serialized: string | null): WatchlistItem[] {
  if (serialized === null) return []

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('La lista guardada en este navegador está dañada. Bórrala desde el almacenamiento del sitio para continuar.')
  }
  if (!Array.isArray(value)) {
    throw new Error('La lista guardada en este navegador no tiene un formato válido.')
  }

  const items: WatchlistItem[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('ticker' in entry) ||
      typeof entry.ticker !== 'string' ||
      !/^[A-Z0-9.^=-]{1,15}$/.test(entry.ticker) ||
      !('name' in entry) ||
      typeof entry.name !== 'string' ||
      !('market' in entry) ||
      typeof entry.market !== 'string'
    ) {
      throw new Error('La lista guardada contiene una empresa con datos no válidos.')
    }
    if (seen.has(entry.ticker)) continue
    seen.add(entry.ticker)
    items.push({ ticker: entry.ticker, name: entry.name, market: entry.market })
  }
  return items
}
