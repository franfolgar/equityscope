import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CompanyData, FinancialPeriod, ValuationAssumptions } from '../../src/types.ts'
import {
  calculateHistory,
  calculateMultiples,
  calculateValuation,
  defaultAssumptions,
  growthForYear,
  qualityFlags,
  valuationVerdict,
} from '../../src/valuation.ts'

const M = 1e6

const base: FinancialPeriod = {
  period: '2024',
  revenue: 1000 * M,
  ebit: 200 * M,
  depreciation: 50 * M,
  ebitda: 250 * M,
  interestExpense: 10 * M,
  interestIncome: 0,
  taxExpense: 40 * M,
  netIncome: 150 * M,
  dilutedShares: 100 * M,
  cash: 300 * M,
  shortTermInvestments: 0,
  shortTermDebt: 50 * M,
  longTermDebt: 150 * M,
  currentLease: 0,
  longTermLease: 0,
  equity: 500 * M,
  inventory: 0,
  receivables: 0,
  payables: 0,
  unearnedRevenue: 0,
  capex: 30 * M,
  changeInWorkingCapital: null,
  minorityInterest: 0,
}

const period = (overrides: Partial<FinancialPeriod> = {}): FinancialPeriod => ({ ...base, ...overrides })

const company = (overrides: Partial<CompanyData> = {}): CompanyData => ({
  ticker: 'TEST',
  name: 'Test Inc.',
  currency: 'USD',
  price: 20,
  periods: [period({ period: '2022' }), period({ period: '2023' }), period({ period: '2024' })],
  ltm: period({ period: 'LTM' }),
  source: 'test',
  asOf: '2026-10-02',
  ...overrides,
})

const assumptions = (overrides: Partial<ValuationAssumptions> = {}): ValuationAssumptions => ({
  revenueGrowth: 0.1,
  terminalGrowth: 0.1,
  ebitMargin: 0.2,
  taxRate: 0.21,
  shareGrowth: 0,
  per: 20,
  evFcf: 20,
  evEbitda: 15,
  evEbit: 18,
  capexToSales: 0.03,
  workingCapitalToSales: 0,
  requiredReturn: 0.1,
  ...overrides,
})

describe('calculateHistory', () => {
  it('resta la caja de la deuda neta (antes la sumaba)', () => {
    // deuda 200 M, caja 300 M => deuda neta -100 M
    const [first] = calculateHistory(company(), 0.21)
    assert.equal(first.netDebt, -100 * M)
    assert.equal(first.netDebtToEbitda, -0.4)
  })

  it('resta también las inversiones a corto plazo', () => {
    const [first] = calculateHistory(company({ periods: [period({ shortTermInvestments: 40 * M })] }), 0.21)
    assert.equal(first.netDebt, -140 * M)
  })

  it('el ratio deuda neta/EBITDA no existe con EBITDA no positivo', () => {
    const [first] = calculateHistory(company({ periods: [period({ ebitda: -5 * M })] }), 0.21)
    assert.equal(first.netDebtToEbitda, null)
  })

  it('calcula la variación de circulante con el balance previo y marca el primer año', () => {
    const periods = [period({ inventory: 100 * M }), period({ inventory: 130 * M })]
    const [first, second] = calculateHistory(company({ periods }), 0.21)
    assert.equal(first.changeInWorkingCapital, 0)
    assert.equal(first.workingCapitalKnown, false)
    assert.equal(second.changeInWorkingCapital, 30 * M)
    assert.equal(second.workingCapitalKnown, true)
  })

  it('respeta una variación informada por el API, incluso si es 0', () => {
    const periods = [period({ inventory: 100 * M }), period({ inventory: 130 * M, changeInWorkingCapital: 0 })]
    assert.equal(calculateHistory(company({ periods }), 0.21)[1].changeInWorkingCapital, 0)
  })
})

describe('calculateMultiples', () => {
  const ltm = calculateHistory(company(), 0.21).at(-1)!

  it('calcula los múltiplos con deuda neta correcta', () => {
    const m = calculateMultiples(20, ltm)
    assert.ok(Math.abs(m.per! - 20 / 1.5) < 1e-9) // 150 M / 100 M acciones = 1,5 por acción
    // EV = 20 * 100 M - 100 M = 1.900 M
    assert.ok(Math.abs(m.evEbitda! - 1900 / 250) < 1e-9)
  })

  it('devuelve null (no 0 ni negativos) cuando la base no es positiva', () => {
    const bad = calculateHistory(
      company({ periods: [period({ netIncome: -1 * M, ebit: -5 * M, ebitda: 0 })] }),
      0.21,
    ).at(-1)!
    const m = calculateMultiples(20, bad)
    assert.equal(m.per, null)
    assert.equal(m.evEbit, null)
    assert.equal(m.evEbitda, null)
  })

  it('no devuelve NaN si la caja neta hace que el valor empresa sea negativo', () => {
    const cashRich = calculateHistory(
      company({
        periods: [
          period({
            cash: 1500 * M,
            shortTermDebt: 0,
            longTermDebt: 0,
          }),
        ],
      }),
      0.21,
    ).at(-1)!
    const multiples = calculateMultiples(10, cashRich)
    assert.equal(multiples.evFcf, null)
    assert.equal(multiples.evEbitda, null)
    assert.equal(multiples.evEbit, null)
  })
})

describe('calculateValuation', () => {
  it('excluye los métodos con base negativa de la media (antes salía un objetivo negativo)', () => {
    const loss = company({ ltm: period({ period: 'LTM', ebit: -50 * M, ebitda: 0, netIncome: -60 * M }) })
    const result = calculateValuation(loss, assumptions({ ebitMargin: -0.05 }))
    const last = result.projections.at(-1)!
    assert.ok(last.prices.every((p) => p === null))
    assert.equal(result.targetPrice, null)
    assert.equal(result.cagr, null)
    assert.equal(result.upside, null)
    assert.equal(result.verdict, 'unknown')
  })

  it('promedia solo los métodos aplicables', () => {
    // margen EBIT 0 => EBIT y PER no aplican por base; EBITDA (solo D&A) sí.
    const result = calculateValuation(company(), assumptions({ ebitMargin: 0 }))
    const last = result.projections.at(-1)!
    assert.equal(last.prices[0], null)
    assert.equal(last.prices[3], null)
    const usable = last.prices.filter((p): p is number => p !== null)
    assert.ok(usable.length >= 1)
    assert.ok(Math.abs(last.averagePrice! - usable.reduce((a, b) => a + b, 0) / usable.length) < 1e-9)
    assert.ok(usable.every((p) => p > 0))
  })

  it('la variación de circulante proyectada es el % de ventas por el incremento de ventas', () => {
    const a = assumptions({ workingCapitalToSales: 0.2, revenueGrowth: 0.3, terminalGrowth: 0.3 })
    const without = calculateValuation(company(), { ...a, workingCapitalToSales: 0 })
    const withWc = calculateValuation(company(), a)
    const delta = without.projections[0].fcf - withWc.projections[0].fcf
    // incremento de ventas del año 1 = 1.000 M * 30 % = 300 M => 0,2 * 300 M = 60 M (antes 78 M)
    assert.ok(Math.abs(delta - 60 * M) < 1)
  })

  it('la deuda neta proyectada baja con el FCF acumulado', () => {
    const result = calculateValuation(company(), assumptions())
    const startNetDebt = calculateHistory(
      company({ periods: [...company().periods, company().ltm] }),
      0.21,
    ).at(-1)!.netDebt
    let expected = startNetDebt
    for (const projection of result.projections) {
      expected -= projection.fcf
      assert.ok(Math.abs(projection.netDebt - expected) < 1)
    }
    assert.ok(result.projections.at(-1)!.netDebt < startNetDebt)
  })

  it('calcula el CAGR de cada método con su propio precio', () => {
    const result = calculateValuation(company(), assumptions())
    const last = result.projections.at(-1)!
    result.methodCagr.forEach((cagr, i) => {
      const price = last.prices[i]
      if (price === null) assert.equal(cagr, null)
      else assert.ok(Math.abs(cagr! - (Math.pow(price / 20, 1 / 5) - 1)) < 1e-12)
    })
    assert.ok(new Set(result.methodCagr).size > 1, 'los CAGR no deben ser todos iguales')
    assert.ok(Math.abs(result.cagr! - (Math.pow(result.targetPrice! / 20, 1 / 5) - 1)) < 1e-12)
  })

  it('con precio no positivo no hay potencial ni CAGR', () => {
    const result = calculateValuation(company({ price: 0 }), assumptions())
    assert.equal(result.upside, null)
    assert.equal(result.cagr, null)
  })

  it('sin acciones no hay precios', () => {
    const noShares = company({
      periods: [period({ dilutedShares: 0 })],
      ltm: period({ period: 'LTM', dilutedShares: 0 }),
    })
    const result = calculateValuation(noShares, assumptions())
    assert.equal(result.targetPrice, null)
  })
})

describe('growthForYear', () => {
  it('converge linealmente del crecimiento inicial al terminal', () => {
    const a = assumptions({ revenueGrowth: 0.2, terminalGrowth: 0.04 })
    assert.equal(growthForYear(a, 1), 0.2)
    assert.ok(Math.abs(growthForYear(a, 3) - 0.12) < 1e-12)
    assert.ok(Math.abs(growthForYear(a, 5) - 0.04) < 1e-12)
  })
})

describe('valuationVerdict', () => {
  it('compara el CAGR con el retorno exigido', () => {
    assert.equal(valuationVerdict(0.12, 0.1), 'attractive')
    assert.equal(valuationVerdict(0.1, 0.1), 'attractive')
    assert.equal(valuationVerdict(0.02, 0.1), 'fair') // +2 %/año ya no es «infravalorada»
    assert.equal(valuationVerdict(-0.01, 0.1), 'expensive')
    assert.equal(valuationVerdict(null, 0.1), 'unknown')
  })
})

describe('defaultAssumptions', () => {
  it('la tasa fiscal ignora los años con pérdidas', () => {
    const periods = [
      period({ period: '2021', ebit: -100 * M, interestExpense: 0, taxExpense: 5 * M }),
      period({ period: '2022' }),
      period({ period: '2023' }),
    ]
    // 40 / (200 - 10) = 21,05 % en los años con beneficio (antes se mezclaba con un 0 % y daba ~14 %)
    const tax = defaultAssumptions(company({ periods })).taxRate
    assert.ok(Math.abs(tax - 40 / 190) < 1e-9)
  })

  it('acota la tasa fiscal al 35 %', () => {
    const periods = [period({ taxExpense: 150 * M }), period({ taxExpense: 150 * M })]
    assert.equal(defaultAssumptions(company({ periods })).taxRate, 0.35)
  })

  it('sin años con beneficio usa el 21 %', () => {
    const periods = [period({ ebit: -10 * M, interestExpense: 0 }), period({ ebit: -10 * M, interestExpense: 0 })]
    assert.equal(defaultAssumptions(company({ periods })).taxRate, 0.21)
  })

  it('acota el crecimiento histórico al 20 % y lo hace converger al 3 %', () => {
    const periods = [
      period({ period: '2022', revenue: 100 * M }),
      period({ period: '2023', revenue: 400 * M }),
      period({ period: '2024', revenue: 1600 * M }),
    ]
    const result = defaultAssumptions(company({ periods }))
    assert.equal(result.revenueGrowth, 0.2)
    assert.equal(result.terminalGrowth, 0.03)
  })

  it('no desvanece un crecimiento ya bajo', () => {
    const periods = [
      period({ period: '2022', revenue: 1000 * M }),
      period({ period: '2023', revenue: 1010 * M }),
      period({ period: '2024', revenue: 1020 * M }),
    ]
    const result = defaultAssumptions(company({ periods }))
    assert.ok(result.revenueGrowth < 0.03)
    assert.equal(result.terminalGrowth, result.revenueGrowth)
  })

  it('un margen EBIT real del 0 % no se sustituye por el 20 %', () => {
    const periods = [period({ ebit: 0, ebitda: 50 * M }), period({ ebit: 0, ebitda: 50 * M })]
    assert.equal(defaultAssumptions(company({ periods })).ebitMargin, 0)
  })

  it('los múltiplos objetivo parten de los actuales de la empresa, acotados a 8x–30x', () => {
    const result = defaultAssumptions(company())
    const ltm = calculateHistory(company({ periods: [...company().periods, company().ltm] }), result.taxRate).at(-1)!
    const current = calculateMultiples(20, ltm)
    const expected = (value: number) => Math.round(Math.min(30, Math.max(8, value)) * 10) / 10
    assert.equal(result.per, expected(current.per!))
    assert.equal(result.evEbitda, expected(current.evEbitda!))
  })

  it('sin base positiva usa los múltiplos genéricos', () => {
    const loss = company({ ltm: period({ period: 'LTM', ebit: -1 * M, ebitda: 0, netIncome: -1 * M }) })
    const result = defaultAssumptions(loss)
    assert.equal(result.per, 20)
    assert.equal(result.evEbitda, 15)
    assert.equal(result.evEbit, 18)
  })

  it('acota el crecimiento de acciones', () => {
    const periods = [period({ dilutedShares: 10 * M }), period({ dilutedShares: 100 * M })]
    assert.equal(defaultAssumptions(company({ periods })).shareGrowth, 0.15)
  })
})

describe('qualityFlags', () => {
  const flag = (flags: ReturnType<typeof qualityFlags>, text: string) => flags.find((f) => f.label.includes(text))!

  it('con EBITDA no positivo y deuda neta positiva salta la alerta de apalancamiento', () => {
    const periods = [period({ ebitda: -10 * M, cash: 0 }), period({ ebitda: -10 * M, cash: 0 })]
    const flags = qualityFlags(calculateHistory(company({ periods }), 0.21))
    assert.equal(flag(flags, 'deuda neta').count, 2)
  })

  it('una empresa con caja neta no salta la alerta de apalancamiento', () => {
    const flags = qualityFlags(calculateHistory(company(), 0.21))
    assert.equal(flag(flags, 'deuda neta').count, 0)
  })

  it('no cuenta como FCF negativo el primer año (sin variación de circulante)', () => {
    const periods = [period({ ebitda: 0, ebit: 0, capex: 100 * M }), period({ ebitda: 0, ebit: 0, capex: 100 * M })]
    const flags = qualityFlags(calculateHistory(company({ periods }), 0.21))
    assert.equal(flag(flags, 'FCF').count, 1)
  })

  it('cuenta ventas decrecientes y dilución', () => {
    const periods = [
      period({ revenue: 1000 * M, dilutedShares: 100 * M }),
      period({ revenue: 900 * M, dilutedShares: 110 * M }),
    ]
    const flags = qualityFlags(calculateHistory(company({ periods }), 0.21))
    assert.equal(flag(flags, 'ventas').count, 1)
    assert.equal(flag(flags, 'dilución').count, 1)
  })

  it('con un solo año no hay comparaciones', () => {
    const flags = qualityFlags(calculateHistory(company({ periods: [period()] }), 0.21))
    assert.equal(flag(flags, 'ventas').count, 0)
    assert.equal(flag(flags, 'dilución').count, 0)
  })
})
