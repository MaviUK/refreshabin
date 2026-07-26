import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Checkout.css'

type BasketLine = {
  id: string
  name: string
  price_pence: number
  quantity: number
}

type Restaurant = {
  id: string
  name: string
  slug: string
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number | null
  delivery_fee_pence: number | null
  free_delivery_threshold_pence: number | null
  preparation_time_minutes: number | null
}

type StorefrontData = {
  restaurant: Restaurant
}

type FulfilmentMethod = 'delivery' | 'collection'

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
})

function formatPostcode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
  if (compact.length <= 3) return compact
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`
}

export default function Checkout() {
  const { slug } = useParams()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [basket, setBasket] = useState<Record<string, BasketLine>>({})
  const [method, setMethod] = useState<FulfilmentMethod>('delivery')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [details, setDetails] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    town: '',
    postcode: '',
    instructions: '',
  })

  useEffect(() => {
    if (!slug) return

    const savedBasket = window.localStorage.getItem(`ordered-food-basket:${slug}`)
    if (savedBasket) {
      try {
        setBasket(JSON.parse(savedBasket))
      } catch {
        window.localStorage.removeItem(`ordered-food-basket:${slug}`)
      }
    }

    const savedCheckout = window.localStorage.getItem(`ordered-food-checkout:${slug}`)
    if (savedCheckout) {
      try {
        const parsed = JSON.parse(savedCheckout)
        if (parsed.details) setDetails(parsed.details)
        if (parsed.method) setMethod(parsed.method)
      } catch {
        window.localStorage.removeItem(`ordered-food-checkout:${slug}`)
      }
    }

    async function loadRestaurant() {
      setLoading(true)
      const { data, error: rpcError } = await supabase.rpc('get_public_storefront', {
        storefront_slug: slug,
      })

      if (rpcError) {
        setError(rpcError.message)
      } else if (!data) {
        setError('Restaurant not found.')
      } else {
        const storefront = data as StorefrontData
        setRestaurant(storefront.restaurant)
        if (!storefront.restaurant.accepts_delivery && storefront.restaurant.accepts_collection) {
          setMethod('collection')
        }
      }
      setLoading(false)
    }

    loadRestaurant()
  }, [slug])

  const basketLines = Object.values(basket)
  const subtotal = basketLines.reduce((total, line) => total + line.price_pence * line.quantity, 0)
  const deliveryFee = useMemo(() => {
    if (!restaurant || method !== 'delivery') return 0
    if (restaurant.free_delivery_threshold_pence && subtotal >= restaurant.free_delivery_threshold_pence) return 0
    return restaurant.delivery_fee_pence ?? 0
  }, [method, restaurant, subtotal])
  const total = subtotal + deliveryFee
  const minimumShortfall = Math.max((restaurant?.minimum_order_pence ?? 0) - subtotal, 0)

  function updateField(field: keyof typeof details, value: string) {
    setDetails((current) => ({ ...current, [field]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!slug || !restaurant || !basketLines.length || minimumShortfall > 0) return

    const requiredDeliveryFields = method === 'delivery'
      ? details.addressLine1 && details.town && details.postcode
      : true

    if (!details.firstName || !details.lastName || !details.email || !details.phone || !requiredDeliveryFields) return

    window.localStorage.setItem(`ordered-food-checkout:${slug}`, JSON.stringify({
      method,
      details,
      restaurantId: restaurant.id,
      subtotalPence: subtotal,
      deliveryFeePence: deliveryFee,
      totalPence: total,
      basket: basketLines,
    }))

    setError('Payment connection is the next step. Your checkout details have been saved.')
  }

  if (loading) return <main className="checkout-state">Loading checkout…</main>
  if (error && !restaurant) return <main className="checkout-state"><h1>Unable to open checkout</h1><p>{error}</p></main>
  if (!restaurant || !slug) return null

  if (!basketLines.length) {
    return (
      <main className="checkout-state">
        <h1>Your basket is empty</h1>
        <p>Add items before continuing to checkout.</p>
        <Link className="checkout-back-link" to={`/r/${slug}`}>Return to menu</Link>
      </main>
    )
  }

  return (
    <main className="checkout-page">
      <header className="checkout-header">
        <Link to={`/r/${slug}`}>← Back to menu</Link>
        <strong>ordered.food</strong>
        <span>Secure checkout</span>
      </header>

      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={handleSubmit} noValidate>
          <section className="checkout-card">
            <span className="checkout-step">1</span>
            <div className="checkout-section-heading">
              <h1>How would you like your order?</h1>
              <p>Choose delivery or collection from {restaurant.name}.</p>
            </div>

            <div className="fulfilment-options">
              {restaurant.accepts_delivery && (
                <button className={method === 'delivery' ? 'selected' : ''} type="button" onClick={() => setMethod('delivery')}>
                  <strong>Delivery</strong>
                  <span>Delivered to your address</span>
                </button>
              )}
              {restaurant.accepts_collection && (
                <button className={method === 'collection' ? 'selected' : ''} type="button" onClick={() => setMethod('collection')}>
                  <strong>Collection</strong>
                  <span>Collect from the restaurant</span>
                </button>
              )}
            </div>
          </section>

          <section className="checkout-card">
            <span className="checkout-step">2</span>
            <div className="checkout-section-heading">
              <h2>Your details</h2>
              <p>We will use these details for order updates.</p>
            </div>

            <div className="checkout-fields two-column">
              <label>First name<input value={details.firstName} onChange={(event) => updateField('firstName', event.target.value)} required /></label>
              <label>Last name<input value={details.lastName} onChange={(event) => updateField('lastName', event.target.value)} required /></label>
              <label>Email<input type="email" value={details.email} onChange={(event) => updateField('email', event.target.value)} required /></label>
              <label>Mobile number<input type="tel" value={details.phone} onChange={(event) => updateField('phone', event.target.value)} required /></label>
            </div>
          </section>

          {method === 'delivery' && (
            <section className="checkout-card">
              <span className="checkout-step">3</span>
              <div className="checkout-section-heading">
                <h2>Delivery address</h2>
                <p>Enter the address where you would like your order delivered.</p>
              </div>

              <div className="checkout-fields">
                <label>Address line 1<input value={details.addressLine1} onChange={(event) => updateField('addressLine1', event.target.value)} required /></label>
                <label>Address line 2 <span>Optional</span><input value={details.addressLine2} onChange={(event) => updateField('addressLine2', event.target.value)} /></label>
                <div className="two-column">
                  <label>Town or city<input value={details.town} onChange={(event) => updateField('town', event.target.value)} required /></label>
                  <label>Postcode<input value={details.postcode} onChange={(event) => updateField('postcode', formatPostcode(event.target.value))} required /></label>
                </div>
                <label>Delivery instructions <span>Optional</span><textarea value={details.instructions} onChange={(event) => updateField('instructions', event.target.value)} rows={3} placeholder="Door number, access instructions or anything the driver should know" /></label>
              </div>
            </section>
          )}

          <section className="checkout-card checkout-payment-placeholder">
            <span className="checkout-step">{method === 'delivery' ? '4' : '3'}</span>
            <div className="checkout-section-heading">
              <h2>Payment</h2>
              <p>Card, Apple Pay and Google Pay will be connected here.</p>
            </div>
            <div className="payment-placeholder">Secure payment connection coming next</div>
          </section>

          {submitted && minimumShortfall > 0 && <p className="checkout-error">Add {money.format(minimumShortfall / 100)} more to meet the minimum order.</p>}
          {error && restaurant && <p className="checkout-message">{error}</p>}
          <button className="checkout-submit" type="submit" disabled={minimumShortfall > 0}>Continue to payment · {money.format(total / 100)}</button>
        </form>

        <aside className="checkout-summary">
          <span>Your order from</span>
          <h2>{restaurant.name}</h2>
          <div className="checkout-summary-lines">
            {basketLines.map((line) => (
              <div key={line.id}>
                <span>{line.quantity} × {line.name}</span>
                <strong>{money.format((line.price_pence * line.quantity) / 100)}</strong>
              </div>
            ))}
          </div>
          <div className="checkout-summary-costs">
            <div><span>Subtotal</span><strong>{money.format(subtotal / 100)}</strong></div>
            {method === 'delivery' && <div><span>Delivery</span><strong>{deliveryFee ? money.format(deliveryFee / 100) : 'Free'}</strong></div>}
            <div className="checkout-summary-total"><span>Total</span><strong>{money.format(total / 100)}</strong></div>
          </div>
          {restaurant.preparation_time_minutes && <p>Estimated {method}: {restaurant.preparation_time_minutes} minutes</p>}
        </aside>
      </div>
    </main>
  )
}
