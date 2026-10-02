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
  /** `null` = el API no lo informa; se calcula con el balance de dos períodos. */
  changeInWorkingCapital: number | null
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
  /** Avisos del API (LTM aproximado, conversión de moneda, datos ausentes...). */
  warnings?: string[]
}

export interface ValuationAssumptions {
  revenueGrowth: number
  /** Crecimiento del año 5; el crecimiento converge linealmente hacia él. */
  terminalGrowth: number
  ebitMargin: number
  taxRate: number
  shareGrowth: number
  per: number
  evFcf: number
  evEbitda: number
  evEbit: number
  capexToSales: number
  workingCapitalToSales: number
  /** Retorno anual exigido para considerar atractiva la valoración. */
  requiredReturn: number
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
  /** Precio por método (PER, EV/FCF, EV/EBITDA, EV/EBIT); `null` si no aplica. */
  prices: (number | null)[]
  averagePrice: number | null
}

export interface ComputedPeriod extends Omit<FinancialPeriod, 'changeInWorkingCapital'> {
  changeInWorkingCapital: number
  /** `false` en el primer año (sin balance previo): su FCF no incluye la variación de circulante. */
  workingCapitalKnown: boolean
  fcf: number
  fcfMargin: number
  ebitMargin: number
  roic: number
  netDebt: number
  /** `null` cuando el EBITDA no es positivo. */
  netDebtToEbitda: number | null
}

export interface Multiples {
  per: number | null
  evFcf: number | null
  evEbitda: number | null
  evEbit: number | null
}

export type Verdict = 'attractive' | 'fair' | 'expensive' | 'unknown'

export interface QualityFlag {
  label: string
  count: number
  severity: 'warning' | 'danger'
}

export interface ValuationResult {
  history: ComputedPeriod[]
  projections: Projection[]
  targetPrice: number | null
  upside: number | null
  cagr: number | null
  /** CAGR a 5 años de cada método, en el mismo orden que `Projection.prices`. */
  methodCagr: (number | null)[]
  multiples: Multiples
  verdict: Verdict
}
