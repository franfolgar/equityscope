import type {
  CompanyData,
  ComputedPeriod,
  Multiples,
  Projection,
  QualityFlag,
  ValuationAssumptions,
  ValuationResult,
  Verdict,
} from './types'

export const PROJECTION_YEARS = 5
const HIGH_LEVERAGE = 2.5
const LOW_ROIC = 0.1

const safeDivide = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : 0

const isPositive = (value: number) => Number.isFinite(value) && value > 0

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const average = (values: number[]) => {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : 0
}

/** El múltiplo solo aplica si el numerador y el denominador son positivos y finitos. */
const positiveRatio = (numerator: number | null, denominator: number) =>
  numerator !== null && isPositive(numerator) && isPositive(denominator)
    ? numerator / denominator
    : null

const operatingWorkingCapital = (period: {
  inventory: number
  receivables: number
  payables: number
  unearnedRevenue: number
}) => period.inventory + period.receivables - period.payables - period.unearnedRevenue

export function calculateHistory(data: CompanyData, taxRate: number): ComputedPeriod[] {
  return data.periods.map((period, index, periods) => {
    const previous = periods[index - 1]
    const workingCapital = operatingWorkingCapital(period)
    const workingCapitalKnown = period.changeInWorkingCapital != null || previous !== undefined
    const changeInWorkingCapital =
      period.changeInWorkingCapital ?? (previous ? workingCapital - operatingWorkingCapital(previous) : 0)
    // Deuda financiera menos caja e inversiones a corto plazo. Los arrendamientos
    // se dejan fuera (con US GAAP el gasto por alquiler operativo ya resta del EBITDA).
    const netDebt =
      period.shortTermDebt + period.longTermDebt - period.cash - period.shortTermInvestments
    const investedCapital =
      period.equity +
      period.shortTermDebt +
      period.longTermDebt +
      period.currentLease +
      period.longTermLease -
      period.shortTermInvestments
    const interest = -Math.abs(period.interestExpense) + period.interestIncome
    const fcf =
      period.ebitda -
      Math.abs(period.capex) +
      interest -
      Math.abs(period.taxExpense || period.ebit * taxRate) -
      changeInWorkingCapital +
      period.minorityInterest

    return {
      ...period,
      changeInWorkingCapital,
      workingCapitalKnown,
      fcf,
      fcfMargin: safeDivide(fcf, period.revenue),
      ebitMargin: safeDivide(period.ebit, period.revenue),
      roic: safeDivide(period.ebit * (1 - taxRate), investedCapital),
      netDebt,
      netDebtToEbitda: isPositive(period.ebitda) ? netDebt / period.ebitda : null,
    }
  })
}

/** Múltiplos de mercado sobre el LTM; `null` si la base no es positiva. */
export function calculateMultiples(price: number, ltm: ComputedPeriod): Multiples {
  const shares = ltm.dilutedShares
  const enterpriseValue = price * shares + ltm.netDebt
  const ev = isPositive(enterpriseValue) ? enterpriseValue : null
  return {
    per: isPositive(shares) ? positiveRatio(price, ltm.netIncome / shares) : null,
    evFcf: positiveRatio(ev, ltm.fcf),
    evEbitda: positiveRatio(ev, ltm.ebitda),
    evEbit: positiveRatio(ev, ltm.ebit),
  }
}

/** Crecimiento del año `year` (1..5): converge linealmente hacia `terminalGrowth`. */
export function growthForYear(assumptions: ValuationAssumptions, year: number): number {
  const progress = PROJECTION_YEARS > 1 ? (year - 1) / (PROJECTION_YEARS - 1) : 0
  return assumptions.revenueGrowth + (assumptions.terminalGrowth - assumptions.revenueGrowth) * progress
}

/** Un método solo vale si su base es positiva y da un precio positivo. */
const validPrice = (base: number, compute: () => number): number | null => {
  if (!isPositive(base)) return null
  const price = compute()
  return isPositive(price) ? price : null
}

const annualized = (targetPrice: number | null, price: number): number | null =>
  targetPrice !== null && isPositive(targetPrice) && isPositive(price)
    ? Math.pow(targetPrice / price, 1 / PROJECTION_YEARS) - 1
    : null

export function valuationVerdict(cagr: number | null, requiredReturn: number): Verdict {
  if (cagr === null) return 'unknown'
  if (cagr >= requiredReturn) return 'attractive'
  if (cagr >= 0) return 'fair'
  return 'expensive'
}

export function calculateValuation(
  data: CompanyData,
  assumptions: ValuationAssumptions,
): ValuationResult {
  const history = calculateHistory(data, assumptions.taxRate)
  const allPeriods = calculateHistory(
    { ...data, periods: [...data.periods, data.ltm] },
    assumptions.taxRate,
  )
  const ltm = allPeriods.at(-1)!
  const projections: Projection[] = []
  let revenue = ltm.revenue
  let depreciation = ltm.depreciation
  let shares = ltm.dilutedShares || data.ltm.dilutedShares
  // La deuda neta evoluciona con el FCF generado (se asume que no se reparte
  // a los accionistas: dividendos y recompras no están modelados).
  let netDebt = ltm.netDebt

  for (let year = 1; year <= PROJECTION_YEARS; year += 1) {
    const growth = growthForYear(assumptions, year)
    const previousRevenue = revenue
    revenue *= 1 + growth
    depreciation *= 1 + growth
    shares *= 1 + assumptions.shareGrowth
    const ebit = revenue * assumptions.ebitMargin
    const ebitda = ebit + depreciation
    const netIncome =
      (ebit - Math.abs(ltm.interestExpense) + ltm.interestIncome) * (1 - assumptions.taxRate)
    const capex = revenue * assumptions.capexToSales
    // La variación del circulante es la del nivel (% de ventas) entre dos años.
    const workingCapitalChange = assumptions.workingCapitalToSales * (revenue - previousRevenue)
    const fcf =
      ebitda -
      capex -
      Math.abs(ltm.interestExpense) +
      ltm.interestIncome -
      ebit * assumptions.taxRate -
      workingCapitalChange +
      ltm.minorityInterest
    netDebt -= fcf
    const investedCapital = Math.max(
      1,
      ltm.equity +
        ltm.shortTermDebt +
        ltm.longTermDebt +
        ltm.currentLease +
        ltm.longTermLease -
        ltm.shortTermInvestments,
    )
    const hasShares = isPositive(shares)
    const prices = [
      validPrice(netIncome, () => (netIncome * assumptions.per - Math.min(netDebt, 0)) / shares),
      validPrice(fcf, () => (fcf * assumptions.evFcf - netDebt) / shares),
      validPrice(ebitda, () => (ebitda * assumptions.evEbitda - netDebt) / shares),
      validPrice(ebit, () => (ebit * assumptions.evEbit - netDebt) / shares),
    ].map((price) => (hasShares ? price : null))
    const usable = prices.filter((price): price is number => price !== null)

    projections.push({
      year,
      revenue,
      ebitda,
      ebit,
      netIncome,
      fcf,
      shares,
      roic: safeDivide(ebit * (1 - assumptions.taxRate), investedCapital),
      netDebt,
      prices,
      averagePrice: usable.length ? average(usable) : null,
    })
  }

  const last = projections.at(-1)!
  const targetPrice = last.averagePrice
  const cagr = annualized(targetPrice, data.price)
  const upside =
    targetPrice !== null && isPositive(data.price) ? targetPrice / data.price - 1 : null

  return {
    history: history.slice(-5),
    projections,
    targetPrice,
    upside,
    cagr,
    methodCagr: last.prices.map((price) => annualized(price, data.price)),
    multiples: calculateMultiples(data.price, ltm),
    verdict: valuationVerdict(cagr, assumptions.requiredReturn),
  }
}

const DEFAULT_MULTIPLES = { per: 20, evFcf: 20, evEbitda: 15, evEbit: 18 }

/** Parte del múltiplo actual de la empresa (acotado a 8x–30x) o, sin datos, del valor genérico. */
const startingMultiple = (current: number | null, fallback: number) =>
  current === null ? fallback : Math.round(clamp(current, 8, 30) * 10) / 10

export function defaultAssumptions(data: CompanyData): ValuationAssumptions {
  const history = data.periods.slice(-5)

  const growth = clamp(
    average(
      history.slice(1).map((period, index) => {
        const previousRevenue = history[index].revenue
        return previousRevenue > 0 ? period.revenue / previousRevenue - 1 : Number.NaN
      }),
    ),
    -0.2,
    0.2,
  )
  const ebitMargins = history
    .filter((period) => period.revenue > 0)
    .map((period) => period.ebit / period.revenue)
  // Solo los años con beneficio antes de impuestos positivo; acotada a 0–35 %.
  const effectiveRates = history
    .map((period) => {
      const earningsBeforeTax = period.ebit - Math.abs(period.interestExpense) + period.interestIncome
      return earningsBeforeTax > 0 ? Math.abs(period.taxExpense) / earningsBeforeTax : Number.NaN
    })
    .filter(Number.isFinite)
  const taxRate = effectiveRates.length ? clamp(average(effectiveRates), 0, 0.35) : 0.21
  const shareGrowth = clamp(
    average(
      history.slice(1).map((period, index) => {
        const previousShares = history[index].dilutedShares
        return previousShares > 0 && period.dilutedShares > 0
          ? period.dilutedShares / previousShares - 1
          : Number.NaN
      }),
    ),
    -0.15,
    0.15,
  )
  const capexToSales = average(
    history.filter((period) => period.revenue > 0).map((period) => Math.abs(period.capex) / period.revenue),
  )
  const workingCapitalToSales = average(
    history
      .filter((period) => period.revenue > 0)
      .map((period) => operatingWorkingCapital(period) / period.revenue),
  )

  const ltm = calculateHistory({ ...data, periods: [...data.periods, data.ltm] }, taxRate).at(-1)!
  const current = calculateMultiples(data.price, ltm)

  return {
    revenueGrowth: growth,
    // Sin desvanecimiento si el crecimiento ya es bajo; si es alto, converge al 3 %.
    terminalGrowth: Math.min(growth, 0.03),
    ebitMargin: ebitMargins.length ? average(ebitMargins) : 0.2,
    taxRate,
    shareGrowth,
    per: startingMultiple(current.per, DEFAULT_MULTIPLES.per),
    evFcf: startingMultiple(current.evFcf, DEFAULT_MULTIPLES.evFcf),
    evEbitda: startingMultiple(current.evEbitda, DEFAULT_MULTIPLES.evEbitda),
    evEbit: startingMultiple(current.evEbit, DEFAULT_MULTIPLES.evEbit),
    capexToSales: capexToSales || 0.05,
    workingCapitalToSales,
    requiredReturn: 0.1,
  }
}

/** Alertas de calidad sobre el histórico anual (en el mismo orden que la interfaz). */
export function qualityFlags(history: ComputedPeriod[]): QualityFlag[] {
  const pairs = history.slice(1).map((period, index) => [history[index], period] as const)
  return [
    {
      label: 'Años con ventas decrecientes',
      count: pairs.filter(([before, after]) => after.revenue < before.revenue).length,
      severity: 'warning',
    },
    {
      label: 'Años con margen EBIT decreciente',
      count: pairs.filter(([before, after]) => after.ebitMargin < before.ebitMargin).length,
      severity: 'warning',
    },
    {
      // El primer año no incluye variación de circulante: no es comparable.
      label: 'Años con FCF negativo',
      count: history.filter((period) => period.workingCapitalKnown && period.fcf < 0).length,
      severity: 'danger',
    },
    {
      label: 'Años con ROIC inferior al 10%',
      count: history.filter((period) => period.roic < LOW_ROIC).length,
      severity: 'warning',
    },
    {
      // Con EBITDA ≤ 0 y deuda neta positiva el apalancamiento es crítico aunque no exista el ratio.
      label: 'Años con deuda neta / EBITDA > 2,5x',
      count: history.filter(
        (period) =>
          period.netDebt > 0 &&
          (period.netDebtToEbitda === null || period.netDebtToEbitda > HIGH_LEVERAGE),
      ).length,
      severity: 'danger',
    },
    {
      label: 'Años con dilución de acciones',
      count: pairs.filter(([before, after]) => after.dilutedShares > before.dilutedShares).length,
      severity: 'warning',
    },
  ]
}
