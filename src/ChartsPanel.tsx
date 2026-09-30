import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ComputedPeriod, Projection } from './types'

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export default function ChartsPanel({
  history,
  projections,
  price,
  currency,
  historicalLastYear,
}: {
  history: ComputedPeriod[]
  projections: Projection[]
  price: number
  currency: string
  historicalLastYear: string
}) {
  const trendData = [
    ...history.map((period) => ({
      year: period.period,
      Ventas: period.revenue / 1_000_000,
      FCF: period.fcf / 1_000_000,
      ROIC: period.roic * 100,
    })),
    ...projections.map((projection) => ({
      year: `Año ${projection.year}`,
      Ventas: projection.revenue / 1_000_000,
      FCF: projection.fcf / 1_000_000,
      ROIC: projection.roic * 100,
    })),
  ]
  const targetData = projections.map((projection) => ({
    year: `Año ${projection.year}`,
    'Precio objetivo': projection.averagePrice,
    'Precio actual': price,
  }))

  return (
    <div className="charts-stack">
      <div className="chart-block">
        <div className="chart-title"><div><strong>Ventas, FCF y ROIC</strong><span>Histórico y proyección a cinco años</span></div></div>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trendData} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#83909e' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="money" tick={{ fontSize: 11, fill: '#83909e' }} axisLine={false} tickLine={false} width={42} />
              <YAxis yAxisId="percent" orientation="right" tick={{ fontSize: 11, fill: '#83909e' }} axisLine={false} tickLine={false} width={38} unit="%" />
              <Tooltip formatter={(value, name) => [typeof value === 'number' ? `${value.toFixed(1)}${name === 'ROIC' ? '%' : ' M'}` : value, name]} />
              <Legend />
              <ReferenceLine yAxisId="money" x={historicalLastYear} stroke="#bdc6d0" strokeDasharray="4 4" />
              <Line yAxisId="money" type="monotone" dataKey="Ventas" stroke="#365fe5" strokeWidth={2.5} dot={false} />
              <Line yAxisId="money" type="monotone" dataKey="FCF" stroke="#18a675" strokeWidth={2.5} dot={false} />
              <Line yAxisId="percent" type="monotone" dataKey="ROIC" stroke="#ec9d43" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart-block">
        <div className="chart-title"><div><strong>Precio actual vs. objetivo</strong><span>Media de los cuatro métodos de valoración</span></div></div>
        <div className="chart-container chart-short">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={targetData} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9edf1" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#83909e' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#83909e' }} axisLine={false} tickLine={false} width={54} />
              <Tooltip formatter={(value) => typeof value === 'number' ? formatCurrency(value, currency) : value} />
              <Legend />
              <Line type="monotone" dataKey="Precio objetivo" stroke="#365fe5" strokeWidth={2.5} />
              <Line type="monotone" dataKey="Precio actual" stroke="#a0aab5" strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
