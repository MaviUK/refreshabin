import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './GiftCards.css'

type GiftCard = {
  id: string
  code: string
  original_value_pence: number
  remaining_value_pence: number
  purchaser_email: string | null
  recipient_email: string | null
  recipient_name: string | null
  message: string | null
  expires_at: string | null
  redeemed_at: string | null
  is_active: boolean
  created_at: string
}

type DashboardData = {
  summary: {
    issued_count: number
    original_value_pence: number
    outstanding_value_pence: number
    redeemed_value_pence: number
  }
  gift_cards: GiftCard[]
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

export default function GiftCards() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState({ value: '25', recipientName: '', recipientEmail: '', purchaserEmail: '', message: '', expiresAt: '' })

  async function load() {
    setLoading(true)
    const { data: result, error: loadError } = await supabase.rpc('get_restaurant_gift_card_dashboard')
    if (loadError) setError(loadError.message)
    else setData(result as DashboardData)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return data?.gift_cards ?? []
    return (data?.gift_cards ?? []).filter((card) => [card.code, card.recipient_email, card.recipient_name, card.purchaser_email].some((value) => value?.toLowerCase().includes(needle)))
  }, [data, query])

  async function createGiftCard(event: FormEvent) {
    event.preventDefault()
    if (creating) return
    setCreating(true)
    setError('')
    setMessage('')
    const valuePence = Math.round(Number(form.value) * 100)
    const { data: created, error: createError } = await supabase.rpc('create_restaurant_gift_card', {
      p_value_pence: valuePence,
      p_recipient_email: form.recipientEmail,
      p_recipient_name: form.recipientName || null,
      p_purchaser_email: form.purchaserEmail || null,
      p_message: form.message || null,
      p_expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    })
    if (createError) setError(createError.message)
    else {
      const result = created as { code: string }
      setMessage(`Gift card ${result.code} created.`)
      setForm({ value: '25', recipientName: '', recipientEmail: '', purchaserEmail: '', message: '', expiresAt: '' })
      await load()
    }
    setCreating(false)
  }

  async function toggle(card: GiftCard) {
    setBusyId(card.id)
    setError('')
    const { error: toggleError } = await supabase.rpc('set_restaurant_gift_card_active', { p_gift_card_id: card.id, p_is_active: !card.is_active })
    if (toggleError) setError(toggleError.message)
    else await load()
    setBusyId('')
  }

  if (loading && !data) return <main className="gift-cards-page"><p>Loading gift cards…</p></main>

  const summary = data?.summary ?? { issued_count: 0, original_value_pence: 0, outstanding_value_pence: 0, redeemed_value_pence: 0 }

  return (
    <main className="gift-cards-page">
      <header className="gift-cards-header"><div><Link to="/dashboard">← Dashboard</Link><span>Commerce</span><h1>Gift cards</h1><p>Create cards, track outstanding balances and manage redemptions.</p></div></header>
      {error && <p className="gift-cards-error" role="alert">{error}</p>}
      {message && <p className="gift-cards-message">{message}</p>}

      <section className="gift-cards-metrics">
        <article><span>Issued</span><strong>{summary.issued_count}</strong></article>
        <article><span>Gift card sales</span><strong>{money.format(summary.original_value_pence / 100)}</strong></article>
        <article><span>Outstanding liability</span><strong>{money.format(summary.outstanding_value_pence / 100)}</strong></article>
        <article><span>Redeemed value</span><strong>{money.format(summary.redeemed_value_pence / 100)}</strong></article>
      </section>

      <section className="gift-cards-layout">
        <form className="gift-card-form" onSubmit={createGiftCard}>
          <div><span>Issue manually</span><h2>Create a gift card</h2><p>Use this for complimentary cards, in-store purchases or customer service replacements.</p></div>
          <label>Value (£)<input type="number" min="5" max="1000" step="0.01" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} required /></label>
          <label>Recipient name<input value={form.recipientName} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} /></label>
          <label>Recipient email<input type="email" value={form.recipientEmail} onChange={(event) => setForm({ ...form, recipientEmail: event.target.value })} required /></label>
          <label>Purchaser email<input type="email" value={form.purchaserEmail} onChange={(event) => setForm({ ...form, purchaserEmail: event.target.value })} /></label>
          <label>Message<textarea rows={3} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label>
          <label>Expiry date<input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label>
          <button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create gift card'}</button>
        </form>

        <section className="gift-card-list">
          <div className="gift-card-list-heading"><div><span>Issued cards</span><h2>Balances and status</h2></div><input aria-label="Search gift cards" placeholder="Search code or email" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          {!filtered.length ? <div className="gift-card-empty">No gift cards found.</div> : filtered.map((card) => {
            const expired = Boolean(card.expires_at && new Date(card.expires_at) <= new Date())
            const status = !card.is_active ? 'Cancelled' : expired ? 'Expired' : card.remaining_value_pence <= 0 ? 'Redeemed' : 'Active'
            return <article className="gift-card-row" key={card.id}>
              <div><strong>{card.code}</strong><span>{card.recipient_name || card.recipient_email || 'Unnamed recipient'}</span><small>Created {date.format(new Date(card.created_at))}{card.expires_at ? ` · Expires ${date.format(new Date(card.expires_at))}` : ''}</small></div>
              <div className="gift-card-balance"><span>{status}</span><strong>{money.format(card.remaining_value_pence / 100)}</strong><small>of {money.format(card.original_value_pence / 100)}</small></div>
              <button type="button" onClick={() => void toggle(card)} disabled={busyId === card.id || card.remaining_value_pence <= 0}>{busyId === card.id ? 'Saving…' : card.is_active ? 'Deactivate' : 'Reactivate'}</button>
            </article>
          })}
        </section>
      </section>
    </main>
  )
}
