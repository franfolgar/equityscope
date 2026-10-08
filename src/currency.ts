import type { CompanyData, FinancialPeriod } from './types'

export const DISPLAY_CURRENCIES = [
  { code: 'EUR', label: 'EUR · Euro' },
  { code: 'USD', label: 'USD · Dólar estadounidense' },
  { code: 'GBP', label: 'GBP · Libra esterlina' },
  { code: 'CHF', label: 'CHF · Franco suizo' },
  { code: 'CAD', label: 'CAD · Dólar canadiense' },
  { code: 'JPY', label: 'JPY · Yen japonés' },
  { code: 'AUD', label: 'AUD · Dólar australiano' },
  { code: 'NZD', label: 'NZD · Dólar neozelandés' },
  { code: 'SEK', label: 'SEK · Corona sueca' },
  { code: 'NOK', label: 'NOK · Corona noruega' },
  { code: 'CNY', label: 'CNY · Yuan chino' },
  { code: 'HKD', label: 'HKD · Dólar de Hong Kong' },
  { code: 'MXN', label: 'MXN · Peso mexicano' },
] as const

function convertPeriod(period: FinancialPeriod, rate: number): FinancialPeriod {
  return {
    ...period,
    revenue: period.revenue * rate,
    ebit: period.ebit * rate,
    depreciation: period.depreciation * rate,
    ebitda: period.ebitda * rate,
    interestExpense: period.interestExpense * rate,
    interestIncome: period.interestIncome * rate,
    taxExpense: period.taxExpense * rate,
    netIncome: period.netIncome * rate,
    cash: period.cash * rate,
    shortTermInvestments: period.shortTermInvestments * rate,
    shortTermDebt: period.shortTermDebt * rate,
    longTermDebt: period.longTermDebt * rate,
    currentLease: period.currentLease * rate,
    longTermLease: period.longTermLease * rate,
    equity: period.equity * rate,
    inventory: period.inventory * rate,
    receivables: period.receivables * rate,
    payables: period.payables * rate,
    unearnedRevenue: period.unearnedRevenue * rate,
    capex: period.capex * rate,
    changeInWorkingCapital: period.changeInWorkingCapital === null
      ? null
      : period.changeInWorkingCapital * rate,
    minorityInterest: period.minorityInterest * rate,
  }
}

export function convertCompanyCurrency(
  company: CompanyData,
  rate: number,
  currency: string,
): CompanyData {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('El tipo de cambio debe ser un número positivo.')
  }
  return {
    ...company,
    currency,
    price: company.price * rate,
    periods: company.periods.map((period) => convertPeriod(period, rate)),
    ltm: convertPeriod(company.ltm, rate),
  }
}
