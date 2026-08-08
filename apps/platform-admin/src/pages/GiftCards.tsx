import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

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

  if (loading) return <section className="admin-page"><p>Loading gift cards…</p></section>

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div><span className="admin-kicker">Finance & liabilities</span><h1>Gift cards</h1><p>Monitor sales, outstanding balances and delivery failures across the platform.</p></div>
        <button type="button" className="admin-secondary-button" onClick={() => void load()}>Refresh</button>
      </header>

      {error && <div className="admin-error" role="alert">{error}</div>}

      <div className="admin-metric-grid">
        <article><span>Purchases</span><strong>{dashboard?.summary.purchase_count ?? 0}</strong></article>
        <article><span>Gift card sales</span><strong>{money.format((dashboard?.summary.paid_value_pence ?? 0) / 100)}</strong></article>
        <article><span>Outstanding liability</span><strong>{money.format((dashboard?.summary.outstanding_value_pence ?? 0) / 100)}</strong></article>
        <article><span>Delivery failures</span><strong>{dashboard?.summary.failed_delivery_count ?? 0}</strong></article>
      </div>

      <section className="admin-table-card">
        <header><div><h2>Purchases and delivery</h2><p>{rows.length} records</p></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search restaurant, email or code" /></header>
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Restaurant</th><th>Recipient</th><th>Value</th><th>Status</th><th>Delivery</th><th>Balance</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.purchase_id}>
              <td><strong>{row.restaurant_name}</strong><small>{row.gift_card_code || 'Not issued yet'}</small></td>
              <td>{row.recipient_email}<small>Buyer: {row.purchaser_email}</small></td>
              <td>{money.format(row.value_pence / 100)}</td>
              <td><span className={`admin-status admin-status--${row.status}`}>{row.status}</span>{row.delivery_error && <small>{row.delivery_error}</small>}</td>
              <td>{dateTime.format(new Date(row.delivery_at))}<small>{row.email_sent_at ? `Sent ${dateTime.format(new Date(row.email_sent_at))}` : 'Waiting to send'}</small></td>
              <td>{row.remaining_value_pence == null ? '—' : money.format(row.remaining_value_pence / 100)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
