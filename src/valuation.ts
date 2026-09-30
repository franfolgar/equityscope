import type {
  CompanyData,
  ComputedPeriod,
  Projection,
  ValuationAssumptions,
} from './types'

const safeDivide = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : 0

const average = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0

export function calculateHistory(data: CompanyData, taxRate: number): ComputedPeriod[] {
  return data.periods.map((period, index, periods) => {
    const previous = periods[index - 1]
    const workingCapital =
      period.inventory + period.receivables - period.payables - period.unearnedRevenue
    const previousWorkingCapital = previous
      ? previous.inventory + previous.receivables - previous.payables - previous.unearnedRevenue
      : workingCapital
    const changeInWorkingCapital = period.changeInWorkingCapital || workingCapital - previousWorkingCapital
    const netDebt =
      period.shortTermDebt +
      period.longTermDebt +
      period.cash -
      period.shortTermInvestments
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
      fcf,
      fcfMargin: safeDivide(fcf, period.revenue),
      ebitMargin: safeDivide(period.ebit, period.revenue),
      roic: safeDivide(period.ebit * (1 - taxRate), investedCapital),
      netDebt,
      netDebtToEbitda: safeDivide(netDebt, period.ebitda),
    }
  })
}

export function calculateValuation(
  data: CompanyData,
  assumptions: ValuationAssumptions,
): { history: ComputedPeriod[]; projections: Projection[]; targetPrice: number; upside: number; cagr: number; multiples: Record<string, number> } {
  const history = calculateHistory(data, assumptions.taxRate)
  const allPeriods = calculateHistory(
    { ...data, periods: [...data.periods, data.ltm] },
    assumptions.taxRate,
  )
  const ltm = allPeriods.at(-1)!
  const annualHistory = history.slice(-5)
  const growth = assumptions.revenueGrowth
  const projections: Projection[] = []
  let revenue = ltm.revenue
  let shares = ltm.dilutedShares || data.ltm.dilutedShares
  const leverageValues = history
    .filter((period) => period.ebitda > 0)
    .map((period) => period.netDebtToEbitda)
    .filter(Number.isFinite)
  const netDebtToEbitda = leverageValues.length
    ? average(leverageValues)
    : safeDivide(ltm.netDebt, ltm.ebitda)

  for (let year = 1; year <= 5; year += 1) {
    revenue *= 1 + growth
    shares *= 1 + assumptions.shareGrowth
    const ebit = revenue * assumptions.ebitMargin
    const ebitda = ebit + ltm.depreciation * Math.pow(1 + growth, year)
    const netIncome = (ebit - Math.abs(ltm.interestExpense) + ltm.interestIncome) * (1 - assumptions.taxRate)
    const capex = revenue * assumptions.capexToSales
    const workingCapitalChange = revenue * assumptions.workingCapitalToSales * growth
    const fcf =
      ebitda -
      capex -
      Math.abs(ltm.interestExpense) +
      ltm.interestIncome -
      ebit * assumptions.taxRate -
      workingCapitalChange +
      ltm.minorityInterest
    const netDebt = netDebtToEbitda * ebitda
    const investedCapital = Math.max(
      1,
      ltm.equity +
        ltm.shortTermDebt +
        ltm.longTermDebt +
        ltm.currentLease +
        ltm.longTermLease -
        ltm.shortTermInvestments,
    )
    const prices = [
      safeDivide(netIncome * assumptions.per - (netDebt < 0 ? netDebt : 0), shares),
      safeDivide(fcf * assumptions.evFcf - netDebt, shares),
      safeDivide(ebitda * assumptions.evEbitda - netDebt, shares),
      safeDivide(ebit * assumptions.evEbit - netDebt, shares),
    ]

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
      averagePrice: average(prices.filter(Number.isFinite)),
    })
  }

  const targetPrice = projections.at(-1)?.averagePrice ?? 0
  const upside = data.price > 0 ? targetPrice / data.price - 1 : 0
  const cagr = targetPrice > 0 && data.price > 0 ? Math.pow(targetPrice / data.price, 1 / 5) - 1 : 0
  const multiples = {
    per: safeDivide(data.price, ltm.netIncome / (ltm.dilutedShares || 1)),
    evFcf: safeDivide(data.price * ltm.dilutedShares + ltm.netDebt, ltm.fcf),
    evEbitda: safeDivide(data.price * ltm.dilutedShares + ltm.netDebt, ltm.ebitda),
    evEbit: safeDivide(data.price * ltm.dilutedShares + ltm.netDebt, ltm.ebit),
  }

  return { history: annualHistory, projections, targetPrice, upside, cagr, multiples }
}

export function defaultAssumptions(data: CompanyData): ValuationAssumptions {
  const history = data.periods.slice(-5)
  const averageValue = (values: number[]) => average(values.filter(Number.isFinite))
  const growth = averageValue(
    history.slice(1).map((period, index) => {
      const previousRevenue = history[index].revenue
      return previousRevenue > 0 ? period.revenue / previousRevenue - 1 : 0
    }),
  )
  const ebitMargin = averageValue(history.map((period) => safeDivide(period.ebit, period.revenue)))
  const taxRate = averageValue(
    history.map((period) => {
      const earningsBeforeTax = period.ebit - Math.abs(period.interestExpense) + period.interestIncome
      return earningsBeforeTax > 0 ? Math.abs(period.taxExpense) / earningsBeforeTax : 0
    }),
  )
  const shareGrowth = averageValue(
    history.slice(1).map((period, index) => {
      const previousShares = history[index].dilutedShares
      return previousShares > 0 ? period.dilutedShares / previousShares - 1 : 0
    }),
  )
  const capexToSales = averageValue(history.map((period) => safeDivide(Math.abs(period.capex), period.revenue)))
  const workingCapitalToSales = averageValue(
    history.map((period) =>
      safeDivide(period.inventory + period.receivables - period.payables - period.unearnedRevenue, period.revenue),
    ),
  )

  return {
    revenueGrowth: Math.max(-0.5, Math.min(growth, 0.5)),
    ebitMargin: ebitMargin || 0.2,
    taxRate: taxRate || 0.21,
    shareGrowth,
    per: 20,
    evFcf: 20,
    evEbitda: 15,
    evEbit: 18,
    capexToSales: capexToSales || 0.05,
    workingCapitalToSales,
  }
}
