import { lazy, Suspense, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  ChevronDown,
  CircleAlert,
  FileSpreadsheet,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { fetchCompany } from './api'
import type { CompanyData, ValuationAssumptions } from './types'
import { calculateHistory, calculateValuation, defaultAssumptions } from './valuation'

const ChartsPanel = lazy(() => import('./ChartsPanel'))

type Tab = 'income' | 'cash' | 'valuation' | 'charts'

const tabs: { id: Tab; label: string }[] = [
  { id: 'income', label: 'Income Statement' },
  { id: 'cash', label: 'Cash Flow & ROIC' },
  { id: 'valuation', label: 'Valoración' },
  { id: 'charts', label: 'Gráficos' },
]

const formatCurrency = (value: number, currency: string, digits = 2) =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0)

const formatPercent = (value: number) =>
  `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value * 100)}%`

const formatMillions = (value: number) =>
  new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value / 1_000_000)

function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`card ${className}`}>{children}</section>
}

function StatCard({
  label,
  value,
  detail,
  icon,
  accent = '',
}: {
  label: string
  value: string
  detail: string
  icon: ReactNode
  accent?: string
}) {
  return (
    <Card className="stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${accent}`}>{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">{detail}</span>
    </Card>
  )
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <label className="assumption-field">
      <span>{label}</span>
      <div className="input-with-suffix">
        <input
          type="number"
          value={Number((value * (suffix === '%' ? 100 : 1)).toFixed(4))}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber
            if (Number.isFinite(next)) onChange(suffix === '%' ? next / 100 : next)
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </label>
  )
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[]
  rows: { label: string; values: (string | number)[]; emphasis?: boolean }[]
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="row-label">Métrica</th>
            {headers.map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={row.emphasis ? 'emphasis-row' : ''} key={row.label}>
              <th className="row-label">{row.label}</th>
              {row.values.map((value, index) => <td key={`${row.label}-${index}`}>{value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [ticker, setTicker] = useState('AAPL')
  const [company, setCompany] = useState<CompanyData | null>(null)
  const [assumptions, setAssumptions] = useState<ValuationAssumptions | null>(null)
  const [tab, setTab] = useState<Tab>('income')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const valuation = useMemo(
    () => company && assumptions ? calculateValuation(company, assumptions) : null,
    [company, assumptions],
  )
  const historical = useMemo(
    () => company && assumptions ? calculateHistory(company, assumptions.taxRate) : [],
    [company, assumptions],
  )
  const tablePeriods = useMemo(
    () => company && assumptions
      ? calculateHistory({ ...company, periods: [...company.periods, company.ltm] }, assumptions.taxRate)
      : historical,
    [company, assumptions, historical],
  )

  async function analyze(event?: FormEvent) {
    event?.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await fetchCompany(ticker)
      setCompany(result)
      setTicker(result.ticker)
      setAssumptions(defaultAssumptions(result))
      setTab('income')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Error desconocido al consultar los datos.')
    } finally {
      setLoading(false)
    }
  }

  function changeAssumption(key: keyof ValuationAssumptions, value: number) {
    setAssumptions((current) => current ? { ...current, [key]: value } : current)
  }

  const latest = historical.at(-1)
  const redFlags = company && valuation
    ? [
        { label: 'Años con ventas decrecientes', count: historical.slice(1).filter((period, i) => period.revenue < historical[i].revenue).length, severity: 'warning' },
        { label: 'Años con margen EBIT decreciente', count: historical.slice(1).filter((period, i) => period.ebitMargin < historical[i].ebitMargin).length, severity: 'warning' },
        { label: 'Años con FCF negativo', count: historical.filter((period) => period.fcf < 0).length, severity: 'danger' },
        { label: 'Años con ROIC inferior al 10%', count: historical.filter((period) => period.roic < 0.1).length, severity: 'warning' },
        { label: 'Años con deuda neta / EBITDA > 2,5x', count: historical.filter((period) => period.netDebtToEbitda > 2.5).length, severity: 'danger' },
        { label: 'Años con dilución de acciones', count: historical.slice(1).filter((period, i) => period.dilutedShares > historical[i].dilutedShares).length, severity: 'warning' },
      ]
    : []
  const latestDilution = historical.length > 1
    ? historical[0].dilutedShares > 0
      ? (latest?.dilutedShares ?? 0) / historical[0].dilutedShares - 1
      : 0
    : 0
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="EquityScope inicio">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.5} /></span>
          <span>equity<span className="brand-light">scope</span></span>
        </a>
        <nav className="top-nav" aria-label="Navegación principal">
          <span className="nav-active">Análisis</span>
          <span>Metodología</span>
          <span className="data-badge"><span /> Datos financieros</span>
        </nav>
      </header>

      <main className="main-content">
        <section className="page-heading">
          <div>
            <div className="eyebrow"><Sparkles size={13} /> INVESTIGACIÓN FUNDAMENTAL</div>
            <h1>Valoración de empresas</h1>
            <p>Análisis financiero y valoración intrínseca en un solo lugar.</p>
          </div>
          <div className="model-chip"><ShieldCheck size={15} /> Modelo IDC · 5 años</div>
        </section>

        <form className="search-panel" onSubmit={analyze}>
          <label htmlFor="ticker-input"><Search size={18} /> Ticker</label>
          <input
            id="ticker-input"
            value={ticker}
            onChange={(event) => setTicker(event.currentTarget.value.toUpperCase())}
            placeholder="Ej. AAPL"
            maxLength={15}
            aria-label="Ticker de la acción"
          />
          <span className="search-hint">NASDAQ · NYSE · Otros mercados</span>
          <button className="primary-button" type="submit" disabled={loading || !ticker.trim()}>
            {loading ? <LoaderCircle className="spin" size={17} /> : <BarChart3 size={17} />}
            {loading ? 'Analizando...' : 'Analizar empresa'}
          </button>
        </form>

        {error && (
          <div role="alert" className="error-banner"><CircleAlert size={18} /> {error}</div>
        )}

        {!company && !loading && (
          <section className="welcome-card">
            <div className="welcome-icon"><BriefcaseBusiness size={24} /></div>
            <h2>Empieza con una empresa</h2>
            <p>Busca un ticker para cargar automáticamente hasta cinco años de estados financieros y calcular una valoración.</p>
            <button type="button" className="secondary-button" onClick={() => { setTicker('AAPL'); void analyze() }}>
              Probar con AAPL <ArrowUpRight size={15} />
            </button>
          </section>
        )}

        {company && valuation && assumptions && (
          <>
            <section className="company-summary">
              <div className="company-name">
                <div className="company-logo">{company.ticker.slice(0, 1)}</div>
                <div>
                  <h2>{company.name}</h2>
                  <span>{company.ticker} <span className="dot-separator">·</span> {company.currency} <span className="dot-separator">·</span> Precio del mercado</span>
                </div>
              </div>
              <div className="company-market">
                <span>Precio actual</span>
                <strong>{formatCurrency(company.price, company.currency)}</strong>
                <small>Actualizado {company.asOf}</small>
              </div>
            </section>

            <section className="stats-grid" aria-label="Métricas principales">
              <StatCard label="Precio actual" value={formatCurrency(company.price, company.currency)} detail="Cotización más reciente" icon={<Activity size={17} />} />
              <StatCard
                label="Precio objetivo · 5 años"
                value={formatCurrency(valuation.targetPrice, company.currency)}
                detail="Media de 4 métodos de valoración"
                icon={<TrendingUp size={17} />}
                accent="green"
              />
              <StatCard
                label="Potencial de revalorización"
                value={formatPercent(valuation.upside)}
                detail="(objetivo ÷ actual) − 1 · según Excel"
                icon={valuation.upside >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                accent={valuation.upside >= 0 ? 'green' : 'red'}
              />
              <StatCard
                label="Valoración general"
                value={valuation.upside > 0 ? 'Infravalorada' : 'Sobrevalorada'}
                detail="Según el objetivo medio del modelo"
                icon={valuation.upside > 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                accent={valuation.upside > 0 ? 'green' : 'red'}
              />
            </section>

            <div className="content-grid">
              <section className="left-column">
                <Card className="analysis-card">
                  <div className="section-head">
                    <div>
                      <h2>Desglose del análisis</h2>
                      <p>Estados financieros, rentabilidad y múltiplos</p>
                    </div>
                    <button className="period-select" type="button" aria-label="Período de análisis">
                      Anual <ChevronDown size={14} />
                    </button>
                  </div>
                  <div className="tabs" role="tablist" aria-label="Secciones de análisis">
                    {tabs.map((item) => (
                      <button
                        className={tab === item.id ? 'tab active' : 'tab'}
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        role="tab"
                        aria-selected={tab === item.id}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  {tab === 'income' && (
                    <>
                      <div className="table-title"><div><FileSpreadsheet size={16} /><strong>Income Statement</strong></div><span>En millones, excepto datos por acción</span></div>
                      <DataTable
                        headers={tablePeriods.map((period) => period.period)}
                        rows={[
                          { label: 'Ventas', values: tablePeriods.map((p) => formatMillions(p.revenue)), emphasis: true },
                          { label: 'Crecimiento de ventas', values: tablePeriods.map((p, i) => i === 0 || tablePeriods[i - 1].revenue <= 0 ? '—' : formatPercent(p.revenue / tablePeriods[i - 1].revenue - 1)) },
                          { label: 'EBITDA', values: tablePeriods.map((p) => formatMillions(p.ebitda)), emphasis: true },
                          { label: 'Margen EBITDA', values: tablePeriods.map((p) => formatPercent(p.revenue ? p.ebitda / p.revenue : 0)) },
                          { label: 'EBIT', values: tablePeriods.map((p) => formatMillions(p.ebit)), emphasis: true },
                          { label: 'Margen EBIT', values: tablePeriods.map((p) => formatPercent(p.ebitMargin)) },
                          { label: 'Beneficio neto', values: tablePeriods.map((p) => formatMillions(p.netIncome)) },
                          { label: 'Acciones diluidas (M)', values: tablePeriods.map((p) => formatMillions(p.dilutedShares)) },
                        ]}
                      />
                    </>
                  )}

                  {tab === 'cash' && (
                    <>
                      <div className="table-title"><div><Activity size={16} /><strong>Cash Flow & ROIC</strong></div><span>En millones</span></div>
                      <DataTable
                        headers={tablePeriods.map((period) => period.period)}
                        rows={[
                          { label: 'EBITDA', values: tablePeriods.map((p) => formatMillions(p.ebitda)) },
                          { label: 'CapEx de mantenimiento', values: tablePeriods.map((p) => formatMillions(-Math.abs(p.capex))) },
                          { label: 'Variación del capital circulante', values: tablePeriods.map((p) => formatMillions(p.changeInWorkingCapital)) },
                          { label: 'Free Cash Flow', values: tablePeriods.map((p) => formatMillions(p.fcf)), emphasis: true },
                          { label: 'Margen FCF', values: tablePeriods.map((p) => formatPercent(p.fcfMargin)) },
                          { label: 'ROIC', values: tablePeriods.map((p) => formatPercent(p.roic)), emphasis: true },
                          { label: 'Deuda neta / EBITDA', values: tablePeriods.map((p) => `${p.netDebtToEbitda.toFixed(1)}x`) },
                        ]}
                      />
                    </>
                  )}

                  {tab === 'valuation' && (
                    <>
                      <div className="table-title"><div><TrendingUp size={16} /><strong>Valoración por múltiplos</strong></div><span>Precio objetivo por acción</span></div>
                      <DataTable
                        headers={['LTM', 'NTM estimado', 'Objetivo', 'CAGR 5a']}
                        rows={[
                          { label: 'PER ex-caja', values: [`${valuation.multiples.per.toFixed(1)}x`, `${(valuation.multiples.per / (1 + assumptions.revenueGrowth)).toFixed(1)}x`, formatCurrency(valuation.projections.at(-1)?.prices[0] ?? 0, company.currency), formatPercent(valuation.cagr)], emphasis: true },
                          { label: 'EV / FCF', values: [`${valuation.multiples.evFcf.toFixed(1)}x`, `${(valuation.multiples.evFcf / (1 + assumptions.revenueGrowth)).toFixed(1)}x`, formatCurrency(valuation.projections.at(-1)?.prices[1] ?? 0, company.currency), formatPercent(valuation.cagr)] },
                          { label: 'EV / EBITDA', values: [`${valuation.multiples.evEbitda.toFixed(1)}x`, `${(valuation.multiples.evEbitda / (1 + assumptions.revenueGrowth)).toFixed(1)}x`, formatCurrency(valuation.projections.at(-1)?.prices[2] ?? 0, company.currency), formatPercent(valuation.cagr)] },
                          { label: 'EV / EBIT', values: [`${valuation.multiples.evEbit.toFixed(1)}x`, `${(valuation.multiples.evEbit / (1 + assumptions.revenueGrowth)).toFixed(1)}x`, formatCurrency(valuation.projections.at(-1)?.prices[3] ?? 0, company.currency), formatPercent(valuation.cagr)] },
                          { label: 'Precio objetivo promedio', values: ['—', '—', formatCurrency(valuation.targetPrice, company.currency), formatPercent(valuation.cagr)], emphasis: true },
                        ]}
                      />
                      <div className="valuation-footnote">Los múltiplos NTM se aproximan usando el crecimiento de ventas como referencia. No es una recomendación de inversión.</div>
                    </>
                  )}

                  {tab === 'charts' && (
                    <Suspense fallback={<div className="chart-loading">Cargando gráficos…</div>}>
                      <ChartsPanel
                        history={valuation.history}
                        projections={valuation.projections}
                        price={company.price}
                        currency={company.currency}
                        historicalLastYear={company.periods.at(-1)?.period ?? ''}
                      />
                    </Suspense>
                  )}
                </Card>

                <Card className="flags-card">
                  <div className="section-head">
                    <div><h2>Señales de calidad</h2><p>Alertas basadas en el histórico disponible</p></div>
                    <span className="flag-count">{redFlags.filter((flag) => flag.count > 0).length} alertas</span>
                  </div>
                  <div className="flags-list">
                    {redFlags.map((flag) => (
                      <div className="flag-row" key={flag.label}>
                        <span className={`flag-indicator ${flag.count > 0 ? flag.severity : 'good'}`} />
                        <span>{flag.label}</span>
                        <strong className={flag.count > 0 ? 'flag-number alert' : 'flag-number'}>{flag.count}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="flag-note"><CircleAlert size={14} /> Dilución mostrada como mejora frente al Excel. Los conteos dependen de los períodos con datos disponibles.</div>
                </Card>
              </section>

              <aside className="right-column">
                <Card className="assumptions-card">
                  <div className="section-head">
                    <div><h2>Supuestos del modelo</h2><p>Modifica las entradas para recalcular</p></div>
                    <span className="editable-tag">EDITABLE</span>
                  </div>
                  <div className="assumptions-group">
                    <div className="group-title">Proyección operativa <span>01</span></div>
                    <NumberInput label="Crecimiento de ventas" value={assumptions.revenueGrowth} onChange={(v) => changeAssumption('revenueGrowth', v)} min={-50} max={100} step={1} suffix="%" />
                    <NumberInput label="Margen EBIT" value={assumptions.ebitMargin} onChange={(v) => changeAssumption('ebitMargin', v)} min={-100} max={100} step={1} suffix="%" />
                    <NumberInput label="Tasa fiscal" value={assumptions.taxRate} onChange={(v) => changeAssumption('taxRate', v)} min={0} max={60} step={1} suffix="%" />
                    <NumberInput label="Crecimiento de acciones" value={assumptions.shareGrowth} onChange={(v) => changeAssumption('shareGrowth', v)} min={-50} max={100} step={0.5} suffix="%" />
                  </div>
                  <div className="assumptions-group">
                    <div className="group-title">Múltiplos objetivo <span>02</span></div>
                    <NumberInput label="PER objetivo" value={assumptions.per} onChange={(v) => changeAssumption('per', v)} min={0} max={100} step={0.5} suffix="x" />
                    <NumberInput label="EV / FCF objetivo" value={assumptions.evFcf} onChange={(v) => changeAssumption('evFcf', v)} min={0} max={100} step={0.5} suffix="x" />
                    <NumberInput label="EV / EBITDA objetivo" value={assumptions.evEbitda} onChange={(v) => changeAssumption('evEbitda', v)} min={0} max={100} step={0.5} suffix="x" />
                    <NumberInput label="EV / EBIT objetivo" value={assumptions.evEbit} onChange={(v) => changeAssumption('evEbit', v)} min={0} max={100} step={0.5} suffix="x" />
                  </div>
                  <details className="advanced-assumptions">
                    <summary>Supuestos avanzados <ChevronDown size={14} /></summary>
                    <NumberInput label="CapEx / ventas" value={assumptions.capexToSales} onChange={(v) => changeAssumption('capexToSales', v)} min={0} max={100} step={0.5} suffix="%" />
                    <NumberInput label="Capital circulante / ventas" value={assumptions.workingCapitalToSales} onChange={(v) => changeAssumption('workingCapitalToSales', v)} min={-100} max={100} step={0.5} suffix="%" />
                  </details>
                  <div className="recalc-note"><Sparkles size={14} /> La valoración se actualiza en tiempo real</div>
                </Card>

                <Card className="returns-card">
                  <div className="returns-heading"><span className="returns-icon"><TrendingUp size={17} /></span><div><strong>Retorno anualizado</strong><small>Valoración a 5 años</small></div></div>
                  <div className="returns-value">{formatPercent(valuation.cagr)}<span>/ año</span></div>
                  <div className="returns-progress"><span style={{ width: `${Math.min(100, Math.max(0, valuation.cagr * 400))}%` }} /></div>
                  <div className="returns-caption"><span>Precio objetivo año 5</span><strong>{formatCurrency(valuation.targetPrice, company.currency)}</strong></div>
                </Card>

                <Card className="method-card">
                  <div className="method-title"><ShieldCheck size={16} /><strong>Metodología</strong></div>
                  <p>Réplicas de las fórmulas IDC: PER ex-caja, EV/FCF, EV/EBITDA y EV/EBIT. Las proyecciones y múltiplos objetivo son editables.</p>
                  <div className="method-source"><span>Fuente financiera</span><strong>{company.source}</strong></div>
                  <div className="method-source"><span>Dilución implícita</span><strong>{formatPercent(latestDilution)}</strong></div>
                </Card>
              </aside>
            </div>

            <footer className="disclaimer">
              <span><CircleAlert size={15} /> Información únicamente educativa; no constituye asesoramiento financiero ni una recomendación de compra o venta.</span>
              <span>Los datos de Yahoo Finance pueden estar incompletos o retrasados. Verifica cifras y moneda antes de tomar decisiones.</span>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}

export default App
