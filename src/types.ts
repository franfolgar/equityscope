export interface FinancialPeriod {
  period: string
  revenue: number
  ebit: number
  depreciation: number
  ebitda: number
  interestExpense: number
  interestIncome: number
  taxExpense: number
  netIncome: number
  dilutedShares: number
  cash: number
  shortTermInvestments: number
  shortTermDebt: number
  longTermDebt: number
  currentLease: number
  longTermLease: number
  equity: number
  inventory: number
  receivables: number
  payables: number
  unearnedRevenue: number
  capex: number
  changeInWorkingCapital: number
  minorityInterest: number
}

export interface CompanyData {
  ticker: string
  name: string
  currency: string
  price: number
  periods: FinancialPeriod[]
  ltm: FinancialPeriod
  source: string
  asOf: string
}

export interface ValuationAssumptions {
  revenueGrowth: number
  ebitMargin: number
  taxRate: number
  shareGrowth: number
  per: number
  evFcf: number
  evEbitda: number
  evEbit: number
  capexToSales: number
  workingCapitalToSales: number
}

export interface Projection {
  year: number
  revenue: number
  ebitda: number
  ebit: number
  netIncome: number
  fcf: number
  shares: number
  roic: number
  netDebt: number
  prices: number[]
  averagePrice: number
}

export interface ComputedPeriod extends FinancialPeriod {
  fcf: number
  fcfMargin: number
  ebitMargin: number
  roic: number
  netDebt: number
  netDebtToEbitda: number
}
