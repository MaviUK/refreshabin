import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Finance.css'

type FinanceOrder = {
  id: string
  order_number: number
  fulfilment_method: 'delivery' | 'collection'
  paid_at: string
  customer_paid_pence: number
  stripe_fee_pence: number
  ordered_food_fee_pence: number
  ordered_food_vat_pence: number
  refund_pence: number
  net_settlement_pence: number
}

type WeeklyInvoice = {
  id: string
  invoice_number: string
  period_start: string
  period_end: string
  order_count: number
  gross_sales_pence: number
  stripe_fees_pence: number
  ordered_food_fees_pence: number
  ordered_food_vat_pence: number
  net_settlement_pence: number
  status: 'generated' | 'sent' | 'failed' | 'void'
  sent_at: string | null
  pdf_path: string | null
  csv_path: string | null
}

type FinanceSnapshot = {
  range: { from: string; to: string }
  summary: {
    order_count: number
    customer_paid_pence: number
    refunded_pence: number
    stripe_fees_pence: number
    ordered_food_fees_pence: number
    ordered_food_vat_pence: number
    net_settlement_pence: number
  }
  orders: FinanceOrder[]
  invoices: WeeklyInvoice[]
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const pounds = (pence: number) => money.format((pence || 0) / 100)
const displayDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export default function Finance() {
  const today = useMemo(() => new Date(), [])
  const initialFrom = useMemo(() => {
    const date = new Date(today)
    date.setDate(date.getDate() - 29)
    return isoDate(date)
  }, [today])
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(isoDate(today))
  const [snapshot, setSnapshot] = useState<FinanceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_restaurant_finance_dashboard', { p_from: from, p_to: to })
    if (loadError) setError(loadError.message)
    else setSnapshot(data as FinanceSnapshot)
    setLoading(false)
  }, [from, to])

  useEffect(() => { void load() }, [load])

  const summary = snapshot?.summary

  return (
    <main className="finance-page">
      <header className="finance-header">
        <div>
          <Link to="/dashboard" className="finance-back">← Back to dashboard</Link>
          <span className="finance-kicker">Restaurant finance</span>
          <h1>Sales, fees and settlements</h1>
          <p>See exactly what customers paid, what Stripe charged, the ordered.food fee and the amount due to your restaurant.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      <section className="finance-filter" aria-label="Finance reporting period">
        <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} max={isoDate(today)} onChange={(event) => setTo(event.target.value)} /></label>
      </section>

      {error && <div className="finance-alert" role="alert">{error}</div>}
      {loading && !snapshot && <section className="finance-card finance-empty">Loading finance data…</section>}

      {snapshot && summary && <>
        <section className="finance-metrics">
          <article><small>Customer paid</small><strong>{pounds(summary.customer_paid_pence)}</strong><span>{summary.order_count} completed order{summary.order_count === 1 ? '' : 's'}</span></article>
          <article><small>Stripe fees</small><strong>−{pounds(summary.stripe_fees_pence)}</strong><span>Payment processing</span></article>
          <article><small>ordered.food fees</small><strong>−{pounds(summary.ordered_food_fees_pence + summary.ordered_food_vat_pence)}</strong><span>Commission including VAT</span></article>
          <article className="finance-net"><small>Net settlement</small><strong>{pounds(summary.net_settlement_pence)}</strong><span>After fees and refunds</span></article>
        </section>

        <section className="finance-card">
          <div className="finance-card-heading"><div><h2>Order settlement breakdown</h2><p>The customer total is reduced only by refunds, Stripe processing and ordered.food commission.</p></div></div>
          {!snapshot.orders.length ? <div className="finance-empty">No settled orders in this period.</div> : <div className="finance-table-wrap"><table className="finance-table">
            <thead><tr><th>Order</th><th>Paid</th><th>Customer paid</th><th>Stripe fee</th><th>ordered.food fee</th><th>Refund</th><th>Restaurant net</th></tr></thead>
            <tbody>{snapshot.orders.map((order) => <tr key={order.id}>
              <td><strong>#{order.order_number}</strong><small>{order.fulfilment_method}</small></td>
              <td>{new Date(order.paid_at).toLocaleDateString('en-GB')}</td>
              <td>{pounds(order.customer_paid_pence)}</td>
              <td className="fee-deduction">−{pounds(order.stripe_fee_pence)}</td>
              <td className="fee-deduction">−{pounds(order.ordered_food_fee_pence + order.ordered_food_vat_pence)}</td>
              <td className="fee-deduction">{order.refund_pence ? `−${pounds(order.refund_pence)}` : '—'}</td>
              <td><strong>{pounds(order.net_settlement_pence)}</strong></td>
            </tr>)}</tbody>
          </table></div>}
        </section>

        <section className="finance-card">
          <div className="finance-card-heading"><div><h2>Weekly invoices</h2><p>A statement is generated for each completed week and emailed to the restaurant account.</p></div></div>
          {!snapshot.invoices.length ? <div className="finance-empty">Your first weekly invoice will appear here after the first completed billing week.</div> : <div className="invoice-list">
            {snapshot.invoices.map((invoice) => <article key={invoice.id}>
              <div><strong>{invoice.invoice_number}</strong><small>{displayDate(invoice.period_start)} – {displayDate(invoice.period_end)} · {invoice.order_count} orders</small></div>
              <div><small>Gross sales</small><strong>{pounds(invoice.gross_sales_pence)}</strong></div>
              <div><small>Total fees</small><strong>−{pounds(invoice.stripe_fees_pence + invoice.ordered_food_fees_pence + invoice.ordered_food_vat_pence)}</strong></div>
              <div><small>Net settlement</small><strong>{pounds(invoice.net_settlement_pence)}</strong></div>
              <span className={`invoice-status invoice-status--${invoice.status}`}>{invoice.status}</span>
              <div className="invoice-actions">
                {invoice.pdf_path && <a href={invoice.pdf_path} target="_blank" rel="noreferrer">PDF</a>}
                {invoice.csv_path && <a href={invoice.csv_path} target="_blank" rel="noreferrer">CSV</a>}
              </div>
            </article>)}
          </div>}
        </section>
      </>}
    </main>
  )
}
