import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './BuyGiftCard.css'

type Restaurant = { id: string; name: string; slug: string }
type CheckoutResponse = { checkout_url?: string; error?: string }

const presetValues = [1000, 2000, 2500, 5000, 10000]
const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

function localDateValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export default function BuyGiftCard() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(searchParams.get('payment') === 'cancelled' ? 'Payment was cancelled. No gift card was created.' : '')
  const [valuePence, setValuePence] = useState(2500)
  const [customValue, setCustomValue] = useState('')
  const [deliveryMode, setDeliveryMode] = useState<'now' | 'later'>('now')
  const [deliveryAt, setDeliveryAt] = useState(localDateValue(new Date(Date.now() + 24 * 60 * 60 * 1000)))
  const [form, setForm] = useState({ purchaserEmail: '', recipientEmail: '', recipientName: '', message: '' })

  useEffect(() => {
    if (!slug) return
    async function load() {
      const { data, error: rpcError } = await supabase.rpc('get_public_gift_card_restaurant', { p_slug: slug })
      if (rpcError || !data) setError('This restaurant is not currently selling gift cards.')
      else setRestaurant(data as Restaurant)
      setLoading(false)
    }
    void load()
  }, [slug])

  function choosePreset(value: number) {
    setValuePence(value)
    setCustomValue('')
  }

  function updateCustom(value: string) {
    setCustomValue(value)
    const pounds = Number(value)
    if (Number.isFinite(pounds)) setValuePence(Math.round(pounds * 100))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!restaurant || submitting) return
    setError('')
    if (valuePence < 500 || valuePence > 100000) {
      setError('Choose a gift card value between £5 and £1,000.')
      return
    }
    setSubmitting(true)
    const { data, error: invokeError } = await supabase.functions.invoke<CheckoutResponse>('create-gift-card-checkout', {
      body: {
        slug: restaurant.slug,
        purchaser_email: form.purchaserEmail,
        recipient_email: form.recipientEmail,
        recipient_name: form.recipientName,
        message: form.message,
        value_pence: valuePence,
        delivery_at: deliveryMode === 'later' ? new Date(deliveryAt).toISOString() : new Date().toISOString(),
      },
    })
    if (invokeError || !data?.checkout_url) {
      setError(data?.error || invokeError?.message || 'Secure payment could not be opened.')
      setSubmitting(false)
      return
    }
    window.location.assign(data.checkout_url)
  }

  if (loading) return <main className="buy-gift-card-state">Loading gift cards…</main>
  if (!restaurant) return <main className="buy-gift-card-state"><h1>Gift cards unavailable</h1><p>{error}</p><Link to={slug ? `/r/${slug}` : '/restaurants'}>Return to restaurant</Link></main>

  return (
    <main className="buy-gift-card-page">
      <header><Link to={`/r/${restaurant.slug}`}>← Back to {restaurant.name}</Link><strong>ordered.food</strong></header>
      <section className="buy-gift-card-hero"><span>Restaurant gift card</span><h1>Give the gift of {restaurant.name}</h1><p>Choose an amount, add a message and send it now or schedule it for later.</p></section>
      <form onSubmit={submit}>
        <section className="buy-gift-card-card">
          <h2>Choose a value</h2>
          <div className="gift-card-value-grid">{presetValues.map((value) => <button type="button" className={!customValue && valuePence === value ? 'selected' : ''} key={value} onClick={() => choosePreset(value)}>{money.format(value / 100)}</button>)}</div>
          <label>Custom amount (£)<input type="number" min="5" max="1000" step="1" value={customValue} onChange={(event) => updateCustom(event.target.value)} placeholder="Other amount" /></label>
        </section>

        <section className="buy-gift-card-card">
          <h2>Who is it for?</h2>
          <div className="buy-gift-card-fields">
            <label>Your email<input type="email" required value={form.purchaserEmail} onChange={(event) => setForm((current) => ({ ...current, purchaserEmail: event.target.value }))} /></label>
            <label>Recipient email<input type="email" required value={form.recipientEmail} onChange={(event) => setForm((current) => ({ ...current, recipientEmail: event.target.value }))} /></label>
            <label>Recipient name <span>Optional</span><input value={form.recipientName} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, recipientName: event.target.value }))} /></label>
            <label>Personal message <span>Optional</span><textarea rows={4} maxLength={500} value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} /></label>
          </div>
        </section>

        <section className="buy-gift-card-card">
          <h2>When should we send it?</h2>
          <div className="gift-card-delivery-options"><button type="button" className={deliveryMode === 'now' ? 'selected' : ''} onClick={() => setDeliveryMode('now')}><strong>Send now</strong><span>Delivered after payment</span></button><button type="button" className={deliveryMode === 'later' ? 'selected' : ''} onClick={() => setDeliveryMode('later')}><strong>Schedule delivery</strong><span>Choose a future date</span></button></div>
          {deliveryMode === 'later' && <label>Delivery date and time<input type="datetime-local" min={localDateValue(new Date())} max={localDateValue(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))} value={deliveryAt} onChange={(event) => setDeliveryAt(event.target.value)} required /></label>}
        </section>

        <aside className="buy-gift-card-summary"><div><span>Gift card value</span><strong>{money.format(valuePence / 100)}</strong></div><p>Valid only at {restaurant.name}. Any unused balance remains on the card.</p>{error && <div className="buy-gift-card-error" role="alert">{error}</div>}<button type="submit" disabled={submitting}>{submitting ? 'Opening secure payment…' : `Pay securely · ${money.format(valuePence / 100)}`}</button></aside>
      </form>
    </main>
  )
}
