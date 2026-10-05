import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWatchlist } from '../../src/watchlist.ts'

test('parseWatchlist restores saved companies and removes duplicates', () => {
  const serialized = JSON.stringify([
    { ticker: 'SAN.MC', name: 'Banco Santander', market: 'Madrid' },
    { ticker: 'SAN.MC', name: 'Duplicate', market: 'Madrid' },
    { ticker: 'AAPL', name: 'Apple Inc.', market: 'NASDAQ' },
  ])

  assert.deepEqual(parseWatchlist(serialized), [
    { ticker: 'SAN.MC', name: 'Banco Santander', market: 'Madrid' },
    { ticker: 'AAPL', name: 'Apple Inc.', market: 'NASDAQ' },
  ])
})

test('parseWatchlist reports corrupted or invalid local data', () => {
  assert.throws(() => parseWatchlist('{'), /está dañada/)
  assert.throws(() => parseWatchlist('{"ticker":"SAN.MC"}'), /formato válido/)
  assert.throws(
    () => parseWatchlist(JSON.stringify([{ ticker: 'SAN.MC/..', name: 'Bad', market: 'Madrid' }])),
    /datos no válidos/,
  )
})
