import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './GiftCards.css'

type GiftCardRow = {
  purchase_id: string
  restaurant_name: string
  restaurant_slug: string
  purchaser_email: string
  recipient_email: string
  value_pence: number
  status: string
  delivery_at: string
  email_sent_at: string | null
  delivery_error: string | null
  gift_card_code: string | null
  remaining_value_pence: number | null
  created_at: string
}

type GiftCardDashboard = {
  summary: {
    purchase_count: number
    paid_value_pence: number
    outstanding_value_pence: number
    delivered_count: number
    failed_delivery_count: number
  }
  purchases: GiftCardRow[]
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'pink' | 'green' | 'amber' | 'blue' }) {
  return <article className="metric"><span className={`metric-dot ${tone}`} /><small>{label}</small><strong>{value}</strong><p>{hint}</p></article>
}

function statusClass(status: string) {
  const value = status.toLowerCase()
  if (['paid', 'issued', 'delivered', 'active'].includes(value)) return 'success'
  if (['failed', 'cancelled', 'expired'].includes(value)) return 'danger'
  if (['pending', 'scheduled', 'processing'].includes(value)) return 'warning'
  return 'neutral'
}

export default function GiftCards() {
  const [dashboard, setDashboard] = useState<GiftCardDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_platform_gift_card_dashboard')
    if (rpcError) setError(rpcError.message)
    else setDashboard(data as GiftCardDashboard)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return dashboard?.purchases ?? []
    return (dashboard?.purchases ?? []).filter((row) => [row.restaurant_name, row.purchaser_email, row.recipient_email, row.gift_card_code, row.status].some((value) => value?.toLowerCase().includes(query)))
  }, [dashboard, search])

  const summary = dashboard?.summary ?? { purchase_count: 0, paid_value_pence: 0, outstanding_value_pence: 0, delivered_count: 0, failed_delivery_count: 0 }
  const deliveryRate = summary.purchase_count ? Math.round((summary.delivered_count / summary.purchase_count) * 100) : 0

  if (loading) return <section className="admin-page gift-card-page"><div className="gift-card-loading"><span>◇</span><strong>Loading gift card analytics…</strong></div></section>

  return (
    <section className="admin-page gift-card-page">
      <header className="page-heading">
        <div><span className="admin-kicker">Finance & liabilities</span><h1>Gift cards</h1><p>Monitor sales, outstanding balances and delivery failures across the platform.</p></div>
        <button type="button" className="secondary-button" onClick={() => void load()}>↻ Refresh</button>
      </header>

      {error && <div className="admin-alert error" role="alert">{error}</div>}

      <div className="metric-grid gift-card-metrics">
        <Metric label="Purchases" value={String(summary.purchase_count)} hint="Gift card orders created" tone="pink" />
        <Metric label="Gift card sales" value={money.format(summary.paid_value_pence / 100)} hint="Paid and issued value" tone="green" />
        <Metric label="Outstanding liability" value={money.format(summary.outstanding_value_pence / 100)} hint="Unredeemed active balance" tone="amber" />
        <Metric label="Delivery failures" value={String(summary.failed_delivery_count)} hint={`${deliveryRate}% successfully delivered`} tone="blue" />
      </div>

      <section className="gift-card-health">
        <article><div><small>Delivery performance</small><strong>{summary.delivered_count} delivered</strong></div><span>{deliveryRate}%</span></article>
        <article><div><small>Average issued value</small><strong>{summary.purchase_count ? money.format(summary.paid_value_pence / summary.purchase_count / 100) : money.format(0)}</strong></div><span>per purchase</span></article>
        <article><div><small>Liability ratio</small><strong>{summary.paid_value_pence ? `${Math.round((summary.outstanding_value_pence / summary.paid_value_pence) * 100)}%` : '0%'}</strong></div><span>of sales outstanding</span></article>
      </section>

      <section className="admin-panel gift-card-panel">
        <div className="panel-heading gift-card-panel-heading">
          <div><h2>Purchases and delivery</h2><p>{rows.length} {rows.length === 1 ? 'record' : 'records'}</p></div>
          <label className="admin-search gift-card-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search restaurant, email or code" /></label>
        </div>

        {rows.length === 0 ? (
          <div className="panel-empty"><strong>{search ? 'No matching gift cards' : 'No gift card purchases yet'}</strong><span>{search ? 'Try a different restaurant, recipient or code.' : 'Purchases will appear here as customers buy gift cards.'}</span></div>
        ) : (
          <div className="financial-table-scroll gift-card-table-wrap">
            <table className="gift-card-table">
              <thead><tr><th>Restaurant</th><th>Recipient</th><th>Value</th><th>Status</th><th>Delivery</th><th>Balance</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.purchase_id}>
                <td><strong>{row.restaurant_name}</strong><small>{row.gift_card_code || 'Not issued yet'}</small></td>
                <td><strong>{row.recipient_email}</strong><small>Buyer: {row.purchaser_email}</small></td>
                <td className="gift-card-money">{money.format(row.value_pence / 100)}</td>
                <td><span className={`gift-card-status ${statusClass(row.status)}`}>{row.status.replaceAll('_', ' ')}</span>{row.delivery_error && <small className="gift-card-error">{row.delivery_error}</small>}</td>
                <td><strong>{dateTime.format(new Date(row.delivery_at))}</strong><small>{row.email_sent_at ? `Sent ${dateTime.format(new Date(row.email_sent_at))}` : 'Waiting to send'}</small></td>
                <td className="gift-card-money">{row.remaining_value_pence == null ? '—' : money.format(row.remaining_value_pence / 100)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
