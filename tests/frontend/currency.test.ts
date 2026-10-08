import assert from 'node:assert/strict'
import test from 'node:test'
import { convertCompanyCurrency } from '../../src/currency.ts'
import type { CompanyData } from '../../src/types.ts'

const company: CompanyData = {
  ticker: 'AAPL',
  name: 'Apple Inc.',
  currency: 'USD',
  price: 100,
  periods: [{
    period: '2025',
    revenue: 1_000,
    ebit: 200,
    depreciation: 30,
    ebitda: 230,
    interestExpense: 10,
    interestIncome: 5,
    taxExpense: 40,
    netIncome: 150,
    dilutedShares: 10,
    cash: 300,
    shortTermInvestments: 20,
    shortTermDebt: 50,
    longTermDebt: 100,
    currentLease: 4,
    longTermLease: 6,
    equity: 500,
    inventory: 25,
    receivables: 35,
    payables: 15,
    unearnedRevenue: 8,
    capex: -30,
    changeInWorkingCapital: null,
    minorityInterest: 0,
  }],
  ltm: {
    period: 'LTM',
    revenue: 1_100,
    ebit: 220,
    depreciation: 33,
    ebitda: 253,
    interestExpense: 11,
    interestIncome: 5,
    taxExpense: 44,
    netIncome: 165,
    dilutedShares: 10,
    cash: 330,
    shortTermInvestments: 22,
    shortTermDebt: 55,
    longTermDebt: 110,
    currentLease: 4,
    longTermLease: 6,
    equity: 550,
    inventory: 27,
    receivables: 38,
    payables: 16,
    unearnedRevenue: 9,
    capex: -33,
    changeInWorkingCapital: 10,
    minorityInterest: 0,
  },
  source: 'Yahoo Finance',
  asOf: '2026-10-08',
}

test('convertCompanyCurrency converts money but preserves share counts and nulls', () => {
  const converted = convertCompanyCurrency(company, 0.9, 'EUR')

  assert.equal(converted.currency, 'EUR')
  assert.equal(converted.price, 90)
  assert.equal(converted.periods[0].revenue, 900)
  assert.equal(converted.periods[0].capex, -27)
  assert.equal(converted.periods[0].dilutedShares, 10)
  assert.equal(converted.periods[0].changeInWorkingCapital, null)
  assert.equal(converted.ltm.changeInWorkingCapital, 9)
  assert.equal(company.price, 100)
})

test('convertCompanyCurrency rejects non-positive or non-finite rates', () => {
  assert.throws(() => convertCompanyCurrency(company, 0, 'EUR'), /número positivo/)
  assert.throws(() => convertCompanyCurrency(company, Number.NaN, 'EUR'), /número positivo/)
})
