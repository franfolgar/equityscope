import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookmarkCheck,
  BookmarkPlus,
  BriefcaseBusiness,
  ChevronDown,
  CircleAlert,
  FileSpreadsheet,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { fetchCompany, fetchCurrencyConversion, searchCompanies } from './api'
import { convertCompanyCurrency, DISPLAY_CURRENCIES } from './currency'
import type { CompanyData, CompanySearchResult, ValuationAssumptions, Verdict } from './types'
import { parseWatchlist, WATCHLIST_STORAGE_KEY, type WatchlistItem } from './watchlist'
import {
  calculateHistory,
  calculateValuation,
  defaultAssumptions,
  qualityFlags,
} from './valuation'

const ChartsPanel = lazy(() => import('./ChartsPanel'))

type Tab = 'income' | 'cash' | 'valuation' | 'charts'

const tabs: { id: Tab; label: string }[] = [
  { id: 'income', label: 'Income Statement' },
  { id: 'cash', label: 'Cash Flow & ROIC' },
  { id: 'valuation', label: 'Valoración' },
  { id: 'charts', label: 'Gráficos' },
]

const marketOptions = [
  { id: 'spain', label: 'España · Bolsa de Madrid' },
  { id: 'nasdaq', label: 'NASDAQ' },
  { id: 'nyse', label: 'NYSE' },
  { id: 'london', label: 'Londres' },
  { id: 'germany', label: 'Alemania · XETRA' },
  { id: 'france', label: 'Francia · Euronext' },
  { id: 'canada', label: 'Canadá · Toronto' },
  { id: 'japan', label: 'Japón' },
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

const formatDateTime = (value: string | undefined) => {
  if (!value) return 'No disponible'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(date)
}

const TICKER_PATTERN = /^[A-Z0-9.^=-]{1,15}$/

function loadWatchlist() {
  try {
    return { items: parseWatchlist(window.localStorage.getItem(WATCHLIST_STORAGE_KEY)), error: '' }
  } catch (caught) {
    return {
      items: [],
      error: caught instanceof Error
        ? caught.message
        : 'Este navegador no permite leer el almacenamiento local de la lista.',
    }
  }
}

const NOT_AVAILABLE = 'n/a'
const formatMoney = (value: number | null, currency: string) =>
  value === null ? NOT_AVAILABLE : formatCurrency(value, currency)
const formatOptionalPercent = (value: number | null) =>
  value === null ? NOT_AVAILABLE : formatPercent(value)
const formatMultiple = (value: number | null) =>
  value === null ? NOT_AVAILABLE : `${value.toFixed(1)}x`

const verdictView: Record<Verdict, { label: string; accent: 'green' | 'red' | '' }> = {
  attractive: { label: 'Infravalorada', accent: 'green' },
  fair: { label: 'Valoración ajustada', accent: '' },
  expensive: { label: 'Sobrevalorada', accent: 'red' },
  unknown: { label: 'Sin datos suficientes', accent: '' },
}

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

const clampValue = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value))

/**
 * Input numérico con texto propio: permite borrar y reescribir el valor (antes
 * se ignoraban los valores vacíos y el campo volvía al número anterior) y
 * acota el valor confirmado a [min, max] (en las unidades mostradas).
 */
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
  const scale = suffix === '%' ? 100 : 1
  const display = (current: number) => String(Number((current * scale).toFixed(4)))
  const [text, setText] = useState(() => display(value))
  return (
    <label className="assumption-field">
      <span>{label}</span>
      <div className="input-with-suffix">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const raw = event.currentTarget.value
            setText(raw)
            const parsed = event.currentTarget.valueAsNumber
            if (raw !== '' && Number.isFinite(parsed)) onChange(clampValue(parsed, min, max) / scale)
          }}
          onBlur={() => setText(display(value))}
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
  const [ticker, setTicker] = useState('')
  const [marketFilter, setMarketFilter] = useState('')
  const [company, setCompany] = useState<CompanyData | null>(null)
  const [displayCurrency, setDisplayCurrency] = useState('')
  const [currencyConversion, setCurrencyConversion] = useState<{
    source: string
    target: string
    rate: number
    fetchedAt: string
  } | null>(null)
  const [currencyError, setCurrencyError] = useState('')
  const [assumptions, setAssumptions] = useState<ValuationAssumptions | null>(null)
  const [analysisId, setAnalysisId] = useState(0)
  const [tab, setTab] = useState<Tab>('income')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchState, setSearchState] = useState<{
    key: string
    results: CompanySearchResult[]
    loading: boolean
    error: string
  }>({ key: '', results: [], loading: false, error: '' })
  const [initialWatchlist] = useState(loadWatchlist)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(initialWatchlist.items)
  const [watchlistError, setWatchlistError] = useState(initialWatchlist.error)
  const selectedSearchTicker = useRef('')
  const pendingRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!company || !displayCurrency || company.currency === displayCurrency) {
      return
    }

    const controller = new AbortController()
    void fetchCurrencyConversion(company.currency, displayCurrency, controller.signal)
      .then((conversion) => setCurrencyConversion(conversion))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setCurrencyConversion(null)
          setCurrencyError(caught instanceof Error ? caught.message : 'No se pudo obtener el tipo de cambio.')
        }
      })

    return () => controller.abort()
  }, [company, displayCurrency])

  useEffect(() => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== WATCHLIST_STORAGE_KEY) return
      try {
        setWatchlist(parseWatchlist(event.newValue))
        setWatchlistError('')
      } catch (caught) {
        setWatchlistError(caught instanceof Error ? caught.message : 'No se pudo leer la lista de seguimiento.')
      }
    }
    window.addEventListener('storage', syncStorage)
    return () => window.removeEventListener('storage', syncStorage)
  }, [])

  useEffect(() => {
    const query = ticker.trim()
    if (selectedSearchTicker.current && selectedSearchTicker.current === query) {
      selectedSearchTicker.current = ''
      return
    }
    selectedSearchTicker.current = ''
    if (query.length < 2 && !marketFilter) return
    const key = `${marketFilter}:${query}`

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setSearchState({ key, results: [], loading: true, error: '' })
      void searchCompanies(query, controller.signal, marketFilter || undefined)
        .then((results) => setSearchState({
          key,
          results: selectedSearchTicker.current && selectedSearchTicker.current === query ? [] : results,
          loading: false,
          error: '',
        }))
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setSearchState({
              key,
              results: [],
              loading: false,
              error: caught instanceof Error ? caught.message : 'No se pudo buscar empresas.',
            })
          }
        })
    }, 350)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [ticker, marketFilter])

  const searchQuery = ticker.trim()
  const activeSearchKey = `${marketFilter}:${searchQuery}`
  const searchResults = searchState.key === activeSearchKey ? searchState.results : []
  const searchLoading = searchState.key === activeSearchKey && searchState.loading
  const searchError = searchState.key === activeSearchKey ? searchState.error : ''

  function storeWatchlist(next: WatchlistItem[]) {
    setWatchlist(next)
    try {
      window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
      setWatchlistError('')
    } catch {
      setWatchlistError('No se pudo guardar en este navegador. Comprueba el espacio disponible o los permisos de almacenamiento.')
    }
  }

  function toggleWatchlist() {
    if (!company) return
    const exists = watchlist.some((item) => item.ticker === company.ticker)
    storeWatchlist(exists
      ? watchlist.filter((item) => item.ticker !== company.ticker)
      : [...watchlist, {
          ticker: company.ticker,
          name: company.name,
          market: company.market || '',
        }])
  }

  function chooseSearchResult(result: CompanySearchResult) {
    selectedSearchTicker.current = result.ticker
    setTicker(result.ticker)
    setSearchState({ key: `${marketFilter}:${result.ticker}`, results: [], loading: false, error: '' })
    void analyze(undefined, result.ticker, result.market)
  }

  const activeConversion = company &&
    currencyConversion?.source === company.currency &&
    currencyConversion.target === displayCurrency
    ? currencyConversion
    : null
  const currencyLoading = Boolean(
    company &&
    displayCurrency !== company.currency &&
    !activeConversion &&
    !currencyError,
  )
  const displayedCurrency = activeConversion?.target ?? company?.currency ?? ''
  const displayCompany = useMemo(
    () => company
      ? activeConversion
        ? convertCompanyCurrency(company, activeConversion.rate, activeConversion.target)
        : company
      : null,
    [company, activeConversion],
  )

  const valuation = useMemo(
    () => displayCompany && assumptions ? calculateValuation(displayCompany, assumptions) : null,
    [displayCompany, assumptions],
  )
  const historical = useMemo(
    () => displayCompany && assumptions ? calculateHistory(displayCompany, assumptions.taxRate) : [],
    [displayCompany, assumptions],
  )
  const tablePeriods = useMemo(
    () => displayCompany && assumptions
      ? calculateHistory({ ...displayCompany, periods: [...displayCompany.periods, displayCompany.ltm] }, assumptions.taxRate)
      : historical,
    [displayCompany, assumptions, historical],
  )

  async function analyze(event?: FormEvent, symbol = ticker, market?: string) {
    event?.preventDefault()
    selectedSearchTicker.current = symbol.trim().toUpperCase()
    setSearchState({
      key: `${marketFilter}:${symbol.trim().toUpperCase()}`,
      results: [],
      loading: false,
      error: '',
    })
    // Una consulta nueva cancela la anterior: evita que lleguen en desorden.
    pendingRequest.current?.abort()
    const controller = new AbortController()
    pendingRequest.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await fetchCompany(symbol, controller.signal)
      if (controller.signal.aborted) return
      setCompany({ ...result, market: result.market || market || '' })
      setDisplayCurrency(result.currency)
      setCurrencyConversion(null)
      setCurrencyError('')
      selectedSearchTicker.current = result.ticker
      setTicker(result.ticker)
      setAssumptions(defaultAssumptions(result))
      setAnalysisId((current) => current + 1)
      setTab('income')
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'Error desconocido al consultar los datos.')
    } finally {
      if (pendingRequest.current === controller) {
        pendingRequest.current = null
        setLoading(false)
      }
    }
  }

  function changeAssumption(key: keyof ValuationAssumptions, value: number) {
    setAssumptions((current) => current ? { ...current, [key]: value } : current)
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const query = ticker.trim().toUpperCase()
    const searchIsCurrent = searchState.key === activeSearchKey
    const exactSearchResult = searchResults.find((result) => result.ticker === query)
    if (exactSearchResult) {
      chooseSearchResult(exactSearchResult)
    } else if (searchResults.length) {
      chooseSearchResult(searchResults[0])
    } else if (
      searchIsCurrent &&
      !searchLoading &&
      !marketFilter &&
      TICKER_PATTERN.test(query) &&
      (query.length <= 6 || /[0-9.^=-]/.test(query))
    ) {
      void analyze(undefined, query)
    } else if (searchIsCurrent && !searchLoading) {
      setSearchState({
        key: activeSearchKey,
        results: [],
        loading: false,
        error: 'No encontramos empresas con ese nombre o mercado. Prueba otra búsqueda.',
      })
    }
  }

  const latest = historical.at(-1)
  const redFlags = valuation ? qualityFlags(historical) : []
  const latestDilution = historical.length > 1
    ? historical[0].dilutedShares > 0
      ? (latest?.dilutedShares ?? 0) / historical[0].dilutedShares - 1
      : 0
    : 0
  const finalProjection = valuation?.projections.at(-1)
  const applicableMethods = finalProjection?.prices.filter((price) => price !== null).length ?? 0
  const verdict = valuation ? verdictView[valuation.verdict] : verdictView.unknown

  const valuationRows = valuation && assumptions
    ? [
        { label: 'PER ex-caja', multiple: valuation.multiples.per },
        { label: 'EV / FCF', multiple: valuation.multiples.evFcf },
        { label: 'EV / EBITDA', multiple: valuation.multiples.evEbitda },
        { label: 'EV / EBIT', multiple: valuation.multiples.evEbit },
      ].map((row, index) => ({
        label: row.label,
        emphasis: index === 0,
        values: [
          formatMultiple(row.multiple),
          formatMultiple(row.multiple === null ? null : row.multiple / (1 + assumptions.revenueGrowth)),
          formatMoney(finalProjection?.prices[index] ?? null, displayedCurrency || 'USD'),
          formatOptionalPercent(valuation.methodCagr[index] ?? null),
        ],
      }))
    : []

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="EquityScope inicio">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.5} /></span>
          <span>equity<span className="brand-light">scope</span></span>
        </a>
        <nav className="top-nav" aria-label="Navegación principal">
          <span className="nav-active">Análisis</span>
          <a href="#metodologia">Metodología</a>
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
          <div className="model-chip"><ShieldCheck size={15} /> Proyección · 5 años</div>
        </section>

        <form className="search-panel" onSubmit={submitSearch}>
          <label htmlFor="ticker-input"><Search size={18} /> Ticker</label>
          <div className="company-search">
            <input
              id="ticker-input"
              value={ticker}
              onChange={(event) => setTicker(event.currentTarget.value.toUpperCase())}
              placeholder="Ticker o nombre (p. ej. Iberdrola)"
              maxLength={80}
              aria-label="Ticker o nombre de empresa"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={searchResults.length > 0}
              aria-controls="company-search-results"
            />
            {(searchLoading || searchResults.length > 0 || searchError) && (
              <div className="company-search-popover">
                {searchLoading && <div className="search-message" role="status">Buscando empresas...</div>}
                {searchError && <div className="search-message search-message-error" role="status">{searchError}</div>}
                {!!searchResults.length && (
                  <ul id="company-search-results" role="listbox" aria-label="Resultados de empresas">
                    {searchResults.map((result) => (
                      <li key={`${result.ticker}-${result.market}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected="false"
                          onClick={() => chooseSearchResult(result)}
                        >
                          <span><strong>{result.name}</strong><small>{result.ticker}</small></span>
                          <small>{result.market}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="market-filter">
            <label htmlFor="market-select">Mercado</label>
            <select
              id="market-select"
              value={marketFilter}
              disabled={loading}
              onChange={(event) => setMarketFilter(event.currentTarget.value)}
            >
              <option value="">Todos los mercados</option>
              {marketOptions.map((market) => (
                <option key={market.id} value={market.id}>{market.label}</option>
              ))}
            </select>
          </div>
          <span className="search-hint">Busca por nombre o ticker · filtra por mercado</span>
          <button className="primary-button" type="submit" disabled={loading || (!ticker.trim() && !marketFilter)}>
            {loading ? <LoaderCircle className="spin" size={17} /> : <BarChart3 size={17} />}
            {loading ? 'Analizando...' : 'Analizar empresa'}
          </button>
        </form>

        <section className="watchlist-card" aria-labelledby="watchlist-title">
          <div className="watchlist-heading">
            <div>
              <h2 id="watchlist-title">Mi lista de seguimiento</h2>
              <p>Guardada solo en este navegador · {watchlist.length} {watchlist.length === 1 ? 'empresa' : 'empresas'}</p>
            </div>
            {company && (
              <button
                className="watchlist-save-button"
                type="button"
                onClick={toggleWatchlist}
                aria-label={watchlist.some((item) => item.ticker === company.ticker)
                  ? `Quitar ${company.name} de mi lista`
                  : `Guardar ${company.name} en mi lista`}
              >
                {watchlist.some((item) => item.ticker === company.ticker)
                  ? <><BookmarkCheck size={15} /> Guardada</>
                  : <><BookmarkPlus size={15} /> Guardar análisis</>}
              </button>
            )}
          </div>
          {watchlistError && <p className="watchlist-error" role="status">{watchlistError}</p>}
          {watchlist.length ? (
            <ul className="watchlist-items">
              {watchlist.map((item) => (
                <li key={item.ticker}>
                  <button
                    className="watchlist-company"
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      selectedSearchTicker.current = item.ticker
                      setTicker(item.ticker)
                      void analyze(undefined, item.ticker, item.market)
                    }}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.ticker}{item.market ? ` · ${item.market}` : ''}</span>
                  </button>
                  <button
                    className="watchlist-remove"
                    type="button"
                    aria-label={`Quitar ${item.name} de mi lista`}
                    onClick={() => storeWatchlist(watchlist.filter((saved) => saved.ticker !== item.ticker))}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="watchlist-empty">Analiza una empresa y pulsa «Guardar análisis» para añadirla aquí.</p>
          )}
        </section>

        {error && (
          <div role="alert" className="error-banner"><CircleAlert size={18} /> {error}</div>
        )}

        {!company && !loading && (
          <section className="welcome-card">
            <div className="welcome-icon"><BriefcaseBusiness size={24} /></div>
            <h2>Empieza con una empresa</h2>
            <p>Busca un ticker para cargar automáticamente hasta cinco años de estados financieros y calcular una valoración.</p>
            <button type="button" className="secondary-button" onClick={() => { setTicker('AAPL'); void analyze(undefined, 'AAPL') }}>
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
                  <span>{company.ticker}{company.market ? <> <span className="dot-separator">·</span> {company.market}</> : null} <span className="dot-separator">·</span> {displayedCurrency}</span>
                </div>
              </div>
              <div className="company-market">
                <label className="currency-control">
                  <span>Moneda de visualización</span>
                  <select
                    aria-label="Moneda de visualización"
                    value={displayCurrency}
                    onChange={(event) => {
                      setDisplayCurrency(event.currentTarget.value)
                      setCurrencyConversion(null)
                      setCurrencyError('')
                    }}
                  >
                    <option value={company.currency}>{company.currency} · Moneda original</option>
                    {DISPLAY_CURRENCIES.filter((currency) => currency.code !== company.currency).map((currency) => (
                      <option key={currency.code} value={currency.code}>{currency.label}</option>
                    ))}
                  </select>
                </label>
                <span>Precio actual</span>
                <strong>{formatCurrency(displayCompany?.price ?? company.price, displayedCurrency || company.currency)}</strong>
                <small>{company.quoteAsOf
                  ? `Cotización: ${formatDateTime(company.quoteAsOf)}`
                  : `Consulta API: ${formatDateTime(company.fetchedAt)}`}</small>
                {displayCurrency !== company.currency && currencyLoading && (
                  <small role="status">Obteniendo tipo de cambio; se muestran importes en {company.currency} mientras tanto.</small>
                )}
                {displayCurrency !== company.currency && currencyError && (
                  <small className="currency-error" role="alert">{currencyError} Se muestran importes en {company.currency}.</small>
                )}
                {activeConversion && (
                  <small>1 {activeConversion.source} = {new Intl.NumberFormat('es-ES', { maximumFractionDigits: 5 }).format(activeConversion.rate)} {activeConversion.target} · aplicado también a años históricos · cambio de {formatDateTime(activeConversion.fetchedAt)}</small>
                )}
              </div>
            </section>

            {!!company.warnings?.length && (
              <div role="status" className="warning-banner">
                <CircleAlert size={18} />
                <ul>
                  {company.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            <details className="data-quality">
              <summary>
                <span>Procedencia y calidad de los datos</span>
                <small>{company.missingMetrics?.length
                  ? `${company.missingMetrics.length} campos sin dato publicado`
                  : 'Sin campos ausentes detectados'}</small>
              </summary>
              <div className="data-quality-content">
                <p><strong>Proveedor:</strong> {company.source} · <strong>Consulta API:</strong> {formatDateTime(company.fetchedAt)}</p>
                <p><strong>Último ejercicio usado:</strong> {company.statementPeriod || company.periods.at(-1)?.period || 'No disponible'} · <strong>Cotización:</strong> {formatDateTime(company.quoteAsOf ?? undefined)}</p>
                <p>Los campos no publicados se muestran aquí; cuando la fuente no proporciona una partida, el cálculo puede usar cero o una estimación según la métrica. Contrasta los importes con los informes oficiales.</p>
                {!!company.missingMetrics?.length && (
                  <ul>
                    {company.missingMetrics.map((metric) => <li key={metric}>{metric}</li>)}
                  </ul>
                )}
                <p className="data-quality-disclaimer">Yahoo Finance puede retrasar, omitir o revisar datos. «Consulta API» indica cuándo EquityScope obtuvo la respuesta; no garantiza que todos los datos de origen se actualizaran en ese momento.</p>
              </div>
            </details>

            <section className="stats-grid" aria-label="Métricas principales">
              <StatCard label="Precio actual" value={formatCurrency(displayCompany?.price ?? company.price, displayedCurrency || company.currency)} detail="Cotización más reciente" icon={<Activity size={17} />} />
              <StatCard
                label="Precio objetivo · 5 años"
                value={formatMoney(valuation.targetPrice, displayedCurrency || company.currency)}
                detail={`Media de ${applicableMethods} de 4 métodos aplicables`}
                icon={<TrendingUp size={17} />}
                accent="green"
              />
              <StatCard
                label="Potencial de revalorización"
                value={formatOptionalPercent(valuation.upside)}
                detail="(objetivo ÷ actual) − 1 · según Excel"
                icon={valuation.upside !== null && valuation.upside < 0 ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                accent={valuation.upside === null ? '' : valuation.upside >= 0 ? 'green' : 'red'}
              />
              <StatCard
                label="Valoración general"
                value={verdict.label}
                detail={`CAGR ${formatOptionalPercent(valuation.cagr)} frente al ${formatPercent(assumptions.requiredReturn)} exigido`}
                icon={valuation.verdict === 'expensive' ? <ArrowDownRight size={18} /> : valuation.verdict === 'attractive' ? <ArrowUpRight size={18} /> : <Activity size={18} />}
                accent={verdict.accent}
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
                    <span className="period-select">Anual</span>
                  </div>
                  <div className="tabs" role="tablist" aria-label="Secciones de análisis">
                    {tabs.map((item) => (
                      <button
                        className={tab === item.id ? 'tab active' : 'tab'}
                        key={item.id}
                        id={`tab-${item.id}`}
                        onClick={() => setTab(item.id)}
                        role="tab"
                        aria-selected={tab === item.id}
                        aria-controls={`panel-${item.id}`}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
                    {tab === 'income' && (
                      <>
                        <div className="table-title"><div><FileSpreadsheet size={16} /><strong>Income Statement</strong></div><span>Millones de {displayedCurrency}; acciones en millones</span></div>
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
                        <div className="table-title"><div><Activity size={16} /><strong>Cash Flow & ROIC</strong></div><span>Millones de {displayedCurrency}</span></div>
                        <DataTable
                          headers={tablePeriods.map((period) => period.period)}
                          rows={[
                            { label: 'EBITDA', values: tablePeriods.map((p) => formatMillions(p.ebitda)) },
                            { label: 'CapEx de mantenimiento', values: tablePeriods.map((p) => formatMillions(-Math.abs(p.capex))) },
                            { label: 'Variación del capital circulante', values: tablePeriods.map((p) => p.workingCapitalKnown ? formatMillions(p.changeInWorkingCapital) : '—') },
                            { label: 'Free Cash Flow', values: tablePeriods.map((p) => formatMillions(p.fcf)), emphasis: true },
                            { label: 'Margen FCF', values: tablePeriods.map((p) => formatPercent(p.fcfMargin)) },
                            { label: 'ROIC', values: tablePeriods.map((p) => formatPercent(p.roic)), emphasis: true },
                            { label: 'Deuda neta / EBITDA', values: tablePeriods.map((p) => formatMultiple(p.netDebtToEbitda)) },
                          ]}
                        />
                        <div className="valuation-footnote">El primer ejercicio no incluye variación de circulante (no hay balance previo). La del LTM se mide frente al último ejercicio cerrado. n/a: EBITDA no positivo.</div>
                      </>
                    )}

                    {tab === 'valuation' && (
                      <>
                        <div className="table-title"><div><TrendingUp size={16} /><strong>Valoración por múltiplos</strong></div><span>Precio objetivo por acción</span></div>
                        <DataTable
                          headers={['LTM', 'NTM estimado', 'Objetivo', 'CAGR 5a']}
                          rows={[
                            ...valuationRows,
                            { label: 'Precio objetivo promedio', values: ['—', '—', formatMoney(valuation.targetPrice, displayedCurrency || company.currency), formatOptionalPercent(valuation.cagr)], emphasis: true },
                          ]}
                        />
                        <div className="valuation-footnote">Los múltiplos NTM se aproximan usando el crecimiento de ventas como referencia. n/a: el método no aplica (base ≤ 0) y se excluye de la media. No es una recomendación de inversión.</div>
                      </>
                    )}

                    {tab === 'charts' && (
                      <Suspense fallback={<div className="chart-loading">Cargando gráficos…</div>}>
                        <ChartsPanel
                          history={valuation.history}
                          projections={valuation.projections}
                          price={displayCompany?.price ?? company.price}
                          currency={displayedCurrency || company.currency}
                          historicalLastYear={company.periods.at(-1)?.period ?? ''}
                        />
                      </Suspense>
                    )}
                  </div>
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
                <Card className="assumptions-card" key={analysisId}>
                  <div className="section-head">
                    <div><h2>Supuestos del modelo</h2><p>Modifica las entradas para recalcular</p></div>
                    <span className="editable-tag">EDITABLE</span>
                  </div>
                  <div className="assumptions-group">
                    <div className="group-title">Proyección operativa <span>01</span></div>
                    <NumberInput label="Crecimiento de ventas (año 1)" value={assumptions.revenueGrowth} onChange={(v) => changeAssumption('revenueGrowth', v)} min={-50} max={100} step={1} suffix="%" />
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
                    <NumberInput label="Crecimiento de ventas (año 5)" value={assumptions.terminalGrowth} onChange={(v) => changeAssumption('terminalGrowth', v)} min={-50} max={100} step={0.5} suffix="%" />
                    <NumberInput label="CapEx / ventas" value={assumptions.capexToSales} onChange={(v) => changeAssumption('capexToSales', v)} min={0} max={100} step={0.5} suffix="%" />
                    <NumberInput label="Capital circulante / ventas" value={assumptions.workingCapitalToSales} onChange={(v) => changeAssumption('workingCapitalToSales', v)} min={-100} max={100} step={0.5} suffix="%" />
                    <NumberInput label="Retorno anual exigido" value={assumptions.requiredReturn} onChange={(v) => changeAssumption('requiredReturn', v)} min={0} max={50} step={0.5} suffix="%" />
                  </details>
                  <div className="recalc-note"><Sparkles size={14} /> La valoración se actualiza en tiempo real</div>
                </Card>

                <Card className="returns-card">
                  <div className="returns-heading"><span className="returns-icon"><TrendingUp size={17} /></span><div><strong>Retorno anualizado</strong><small>Valoración a 5 años</small></div></div>
                  <div className="returns-value">{formatOptionalPercent(valuation.cagr)}<span>/ año</span></div>
                  <div className="returns-progress"><span style={{ width: `${Math.min(100, Math.max(0, (valuation.cagr ?? 0) * 400))}%` }} /></div>
                  <div className="returns-caption"><span>Precio objetivo año 5</span><strong>{formatMoney(valuation.targetPrice, displayedCurrency || company.currency)}</strong></div>
                </Card>

                <Card className="method-card" >
                  <div className="method-title" id="metodologia"><ShieldCheck size={16} /><strong>Metodología</strong></div>
                  <p>La valoración combina PER ex-caja, EV/FCF, EV/EBITDA y EV/EBIT. Los métodos con base no positiva se excluyen de la media. La deuda neta proyectada baja con el FCF generado; dividendos y recompras no están modelados. Las proyecciones y múltiplos objetivo son editables.</p>
                  <div className="method-source"><span>Fuente financiera</span><strong>{company.source}</strong></div>
                  <div className="method-source"><span>Datos consultados</span><strong>{formatDateTime(company.fetchedAt)}</strong></div>
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
