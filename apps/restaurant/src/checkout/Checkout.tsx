import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { usePlatformConfiguration } from '../lib/platformConfiguration'
import './Checkout.css'

type Ingredient = { id: string; name: string }
type SelectedExtra = { id: string; name: string; price_pence: number; quantity: number }
type SelectedModifierOption = { id: string; name: string; price_pence: number; quantity: number }
type SelectedModifierGroup = { group_id: string; group_name: string; options: SelectedModifierOption[] }
type BasketLine = {
  id: string
  line_id: string
  name: string
  price_pence: number
  unit_price_pence: number
  quantity: number
  removed_ingredients?: Ingredient[]
  selected_extras?: SelectedExtra[]
  selected_modifier_groups?: SelectedModifierGroup[]
  special_instructions?: string
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
  delivery_preparation_time_minutes?: number | null
  collection_preparation_time_minutes?: number | null
  service_fee_pence?: number | null
}
type FulfilmentSettings = {
  delivery_preparation_time_minutes: number
  collection_preparation_time_minutes: number
  service_fee_pence: number
}
type StorefrontData = { restaurant: Restaurant }
type FulfilmentMethod = 'delivery' | 'collection'
type AccountMode = 'create' | 'signin'
type CreatedOrder = {
  order_id: string
  order_number: number
  restaurant_name: string
  subtotal_pence: number
  delivery_fee_pence: number
  service_fee_pence: number
  discount_pence?: number
  promotion_code?: string | null
  total_pence: number
  currency: string
  payment_status: string
  order_status: string
}
type CheckoutSessionResponse = { checkout_url?: string; session_id?: string; error?: string }
type CustomerProfile = {
  first_name: string | null
  last_name: string | null
  phone: string | null
  address_line_1: string | null
  address_line_2: string | null
  town_city: string | null
  postcode: string | null
}
type CustomerAddress = {
  id: string
  label: string
  address_line_1: string
  address_line_2: string | null
  town_city: string
  postcode: string
  delivery_instructions: string | null
  is_default: boolean
}
type PromotionValidation = {
  valid: boolean
  error?: string
  promotion_id?: string
  code?: string
  name?: string
  discount_pence?: number
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const dateTime = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function roundedMinimumTime(minutes: number) {
  const date = new Date(Date.now() + minutes * 60_000)
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0)
  return date
}

function formatPostcode(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7)
  return compact.length <= 3 ? compact : `${compact.slice(0, -3)} ${compact.slice(-3)}`
}

export default function Checkout() {
  const { configuration } = usePlatformConfiguration()
  const scheduledOrdersEnabled = configuration.feature_flags.scheduled_orders
  const { slug } = useParams()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [basket, setBasket] = useState<Record<string, BasketLine>>({})
  const [method, setMethod] = useState<FulfilmentMethod>('delivery')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null)
  const [accountMode, setAccountMode] = useState<AccountMode>('create')
  const [password, setPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string>('new')
  const [timingChoice, setTimingChoice] = useState<'asap' | 'later'>('asap')
  const [requestedTime, setRequestedTime] = useState('')
  const [promotionCode, setPromotionCode] = useState('')
  const [appliedPromotion, setAppliedPromotion] = useState<PromotionValidation | null>(null)
  const [promotionBusy, setPromotionBusy] = useState(false)
  const [promotionError, setPromotionError] = useState('')
  const [details, setDetails] = useState({ firstName: '', lastName: '', email: '', phone: '', addressLine1: '', addressLine2: '', town: '', postcode: '', instructions: '' })

  function applyAddress(address: CustomerAddress) {
    setSelectedAddressId(address.id)
    setDetails((current) => ({
      ...current,
      addressLine1: address.address_line_1,
      addressLine2: address.address_line_2 || '',
      town: address.town_city,
      postcode: address.postcode,
      instructions: address.delivery_instructions || '',
    }))
  }

  async function loadCustomerAddresses(userId: string) {
    const { data } = await supabase
      .from('customer_addresses')
      .select('id,label,address_line_1,address_line_2,town_city,postcode,delivery_instructions,is_default')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })

    const addresses = (data || []) as CustomerAddress[]
    setSavedAddresses(addresses)
    const preferred = addresses.find((address) => address.is_default) || addresses[0]
    if (preferred) applyAddress(preferred)
    else setSelectedAddressId('new')
  }

  useEffect(() => {
    if (!slug) return
    const savedBasket = window.localStorage.getItem(`ordered-food-basket:${slug}`)
    if (savedBasket) {
      try { setBasket(JSON.parse(savedBasket)) } catch { window.localStorage.removeItem(`ordered-food-basket:${slug}`) }
    }
    const savedCheckout = window.localStorage.getItem(`ordered-food-checkout:${slug}`)
    if (savedCheckout) {
      try {
        const parsed = JSON.parse(savedCheckout)
        if (parsed.details) setDetails(parsed.details)
        if (parsed.method) setMethod(parsed.method)
        if (parsed.promotionCode) setPromotionCode(parsed.promotionCode)
      } catch { window.localStorage.removeItem(`ordered-food-checkout:${slug}`) }
    }

    async function loadPage() {
      setLoading(true)
      const [{ data, error: rpcError }, { data: fulfilmentData }, { data: sessionData }] = await Promise.all([
        supabase.rpc('get_public_storefront', { storefront_slug: slug }),
        supabase.rpc('get_public_fulfilment_settings', { storefront_slug: slug }),
        supabase.auth.getSession(),
      ])
      if (rpcError) setError(rpcError.message)
      else if (!data) setError('Restaurant not found.')
      else {
        const storefront = data as StorefrontData
        setRestaurant({ ...storefront.restaurant, ...(fulfilmentData as FulfilmentSettings | null) })
        if (!storefront.restaurant.accepts_delivery && storefront.restaurant.accepts_collection) setMethod('collection')
      }

      const user = sessionData.session?.user
      if (user) {
        setSignedIn(true)
        const { data: profile } = await supabase
          .from('customer_profiles')
          .select('first_name,last_name,phone,address_line_1,address_line_2,town_city,postcode')
          .eq('user_id', user.id)
          .maybeSingle()
        const saved = profile as CustomerProfile | null
        setDetails((current) => ({
          ...current,
          firstName: saved?.first_name || current.firstName,
          lastName: saved?.last_name || current.lastName,
          email: user.email || current.email,
          phone: saved?.phone || current.phone,
          addressLine1: saved?.address_line_1 || current.addressLine1,
          addressLine2: saved?.address_line_2 || current.addressLine2,
          town: saved?.town_city || current.town,
          postcode: saved?.postcode || current.postcode,
        }))
        await Promise.all([supabase.rpc('claim_customer_orders'), loadCustomerAddresses(user.id)])
      }
      setLoading(false)
    }
    void loadPage()
  }, [slug])

  const basketLines = Object.values(basket)
  const subtotal = basketLines.reduce((total, line) => total + (line.unit_price_pence ?? line.price_pence) * line.quantity, 0)
  const deliveryFee = useMemo(() => {
    if (!restaurant || method !== 'delivery') return 0
    if (restaurant.free_delivery_threshold_pence && subtotal >= restaurant.free_delivery_threshold_pence) return 0
    return restaurant.delivery_fee_pence ?? 0
  }, [method, restaurant, subtotal])
  const serviceFee = restaurant?.service_fee_pence ?? 0
  const discount = appliedPromotion?.discount_pence ?? 0
  const total = Math.max(0, subtotal + deliveryFee + serviceFee - discount)
  const minimumShortfall = Math.max((restaurant?.minimum_order_pence ?? 0) - subtotal, 0)
  const defaultMinutes = method === 'delivery'
    ? restaurant?.delivery_preparation_time_minutes ?? restaurant?.preparation_time_minutes ?? 30
    : restaurant?.collection_preparation_time_minutes ?? restaurant?.preparation_time_minutes ?? 20
  const minimumRequestedTime = roundedMinimumTime(defaultMinutes)
  const maximumRequestedTime = new Date(Date.now() + 7 * 24 * 60 * 60_000)
  const requestedDate = requestedTime ? new Date(requestedTime) : null

  useEffect(() => {
    if (!appliedPromotion) return
    setAppliedPromotion(null)
    setPromotionError('Promotion removed because the basket or fulfilment method changed. Apply it again to re-check eligibility.')
  }, [method, subtotal, deliveryFee])

  function updateField(field: keyof typeof details, value: string) {
    setDetails((current) => ({ ...current, [field]: value }))
    if (['addressLine1', 'addressLine2', 'town', 'postcode', 'instructions'].includes(field)) setSelectedAddressId('new')
  }

  function chooseNewAddress() {
    setSelectedAddressId('new')
    setDetails((current) => ({ ...current, addressLine1: '', addressLine2: '', town: '', postcode: '', instructions: '' }))
  }

  async function applyPromotion() {
    if (!restaurant || !promotionCode.trim() || promotionBusy || createdOrder) return
    setPromotionBusy(true)
    setPromotionError('')
    setAppliedPromotion(null)
    const { data, error: validationError } = await supabase.rpc('validate_restaurant_promotion', {
      p_restaurant_id: restaurant.id,
      p_code: promotionCode.trim(),
      p_subtotal_pence: subtotal,
      p_delivery_fee_pence: deliveryFee,
      p_fulfilment_method: method,
      p_customer_email: details.email.trim() || null,
    })
    if (validationError) setPromotionError(validationError.message)
    else {
      const validation = data as PromotionValidation
      if (!validation.valid) setPromotionError(validation.error || 'This promotion code could not be applied.')
      else {
        setAppliedPromotion(validation)
        setPromotionCode(validation.code || promotionCode.trim().toUpperCase())
      }
    }
    setPromotionBusy(false)
  }

  async function authenticateCustomer() {
    if (signedIn) return true
    if (password.length < 8) {
      setError('Your password must be at least 8 characters.')
      return false
    }
    if (accountMode === 'signin') {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: details.email.trim(), password })
      if (signInError) {
        setError('We could not sign you in. Check your email and password, or choose Create account.')
        return false
      }
      setSignedIn(true)
      if (data.user) await loadCustomerAddresses(data.user.id)
      await supabase.rpc('claim_customer_orders')
      return true
    }
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: details.email.trim(),
      password,
      options: { data: { full_name: `${details.firstName} ${details.lastName}`.trim(), account_type: 'customer' } },
    })
    if (signUpError) {
      setError(signUpError.message)
      return false
    }
    if (data.session) {
      setSignedIn(true)
      await supabase.rpc('claim_customer_orders')
    }
    return true
  }

  async function saveProfile() {
    const { data } = await supabase.auth.getUser()
    if (!data.user) return
    await supabase.from('customer_profiles').upsert({
      user_id: data.user.id,
      first_name: details.firstName.trim(),
      last_name: details.lastName.trim(),
      phone: details.phone.trim(),
      address_line_1: method === 'delivery' ? details.addressLine1.trim() : null,
      address_line_2: method === 'delivery' ? details.addressLine2.trim() || null : null,
      town_city: method === 'delivery' ? details.town.trim() : null,
      postcode: method === 'delivery' ? details.postcode.trim() : null,
      updated_at: new Date().toISOString(),
    })

    if (method === 'delivery' && selectedAddressId === 'new') {
      const address = {
        user_id: data.user.id,
        label: savedAddresses.length ? 'Other' : 'Home',
        address_line_1: details.addressLine1.trim(),
        address_line_2: details.addressLine2.trim() || null,
        town_city: details.town.trim(),
        postcode: details.postcode.trim(),
        delivery_instructions: details.instructions.trim() || null,
        is_default: savedAddresses.length === 0,
      }
      const duplicate = savedAddresses.some((saved) =>
        saved.address_line_1.toLowerCase() === address.address_line_1.toLowerCase()
        && saved.postcode.replace(/\s/g, '').toLowerCase() === address.postcode.replace(/\s/g, '').toLowerCase(),
      )
      if (!duplicate) await supabase.from('customer_addresses').insert(address)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setError('')
    setMessage('')
    if (!slug || !restaurant || !basketLines.length || minimumShortfall > 0 || submitting) return
    const requiredDeliveryFields = method === 'delivery' ? details.addressLine1 && details.town && details.postcode : true
    if (!details.firstName || !details.lastName || !details.email || !details.phone || !requiredDeliveryFields) {
      setError('Please complete all required fields.')
      return
    }
    if (scheduledOrdersEnabled && timingChoice === 'later' && (!requestedDate || Number.isNaN(requestedDate.getTime()) || requestedDate < minimumRequestedTime || requestedDate > maximumRequestedTime)) {
      setError(`Choose a ${method} time at least ${defaultMinutes} minutes from now and within the next 7 days.`)
      return
    }

    setSubmitting(true)
    setMessage(signedIn ? 'Creating your order…' : accountMode === 'signin' ? 'Signing in…' : 'Creating your account…')
    const authenticated = await authenticateCustomer()
    if (!authenticated) { setSubmitting(false); setMessage(''); return }

    await saveProfile()
    window.localStorage.setItem(`ordered-food-checkout:${slug}`, JSON.stringify({ method, details, promotionCode: appliedPromotion ? promotionCode : '' }))
    setMessage('Creating your order…')
    const { data, error: orderError } = await supabase.rpc('create_order_with_promotion', {
      storefront_slug: slug,
      fulfilment_method: method,
      customer_first_name: details.firstName,
      customer_last_name: details.lastName,
      customer_email: details.email,
      customer_phone: details.phone,
      basket_items: basketLines.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        removed_ingredients: (line.removed_ingredients || []).map((ingredient) => ({ id: ingredient.id })),
        selected_extras: (line.selected_extras || []).map((extra) => ({ id: extra.id, quantity: extra.quantity })),
        selected_modifier_groups: (line.selected_modifier_groups || []).map((group) => ({ group_id: group.group_id, options: group.options.map((option) => ({ id: option.id, quantity: option.quantity })) })),
        special_instructions: line.special_instructions || null,
      })),
      address_line_1: method === 'delivery' ? details.addressLine1 : null,
      address_line_2: method === 'delivery' ? details.addressLine2 || null : null,
      town_city: method === 'delivery' ? details.town : null,
      postcode: method === 'delivery' ? details.postcode : null,
      delivery_instructions: details.instructions || null,
      requested_fulfilment_at: scheduledOrdersEnabled && timingChoice === 'later' && requestedDate ? requestedDate.toISOString() : null,
      promotion_code: appliedPromotion ? promotionCode : null,
    })

    if (orderError) { setSubmitting(false); setMessage(''); setError(orderError.message); return }
    const order = data as CreatedOrder
    setCreatedOrder(order)
    window.localStorage.setItem(`ordered-food-pending-order:${slug}`, JSON.stringify(order))
    setMessage(`Order #${order.order_number} created. Opening secure payment…`)
    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke<CheckoutSessionResponse>('create-checkout-session', { body: { order_id: order.order_id } })
    if (checkoutError || !checkoutData?.checkout_url) {
      setSubmitting(false)
      setMessage('')
      setError(checkoutData?.error || checkoutError?.message || 'Unable to open secure payment. Please try again.')
      return
    }
    window.location.assign(checkoutData.checkout_url)
  }

  if (loading) return <main className="checkout-state">Loading checkout…</main>
  if (error && !restaurant) return <main className="checkout-state"><h1>Unable to open checkout</h1><p>{error}</p></main>
  if (!restaurant || !slug) return null
  if (!basketLines.length) return <main className="checkout-state"><h1>Your basket is empty</h1><p>Add items before continuing to checkout.</p><Link className="checkout-back-link" to={`/r/${slug}`}>Return to menu</Link></main>

  const addressStep = method === 'delivery' ? 3 : null
  const accountStep = method === 'delivery' ? 4 : 3
  const paymentStep = method === 'delivery' ? 5 : 4

  return (
    <main className="checkout-page">
      <header className="checkout-header"><Link to={`/r/${slug}`}>← Back to menu</Link><strong>ordered.food</strong><Link to="/account/orders">My orders</Link></header>
      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={handleSubmit} noValidate>
          <section className="checkout-card">
            <span className="checkout-step">1</span>
            <div className="checkout-section-heading"><h1>How would you like your order?</h1><p>Choose delivery or collection from {restaurant.name}.</p></div>
            <div className="fulfilment-options">
              {restaurant.accepts_delivery && <button className={method === 'delivery' ? 'selected' : ''} type="button" onClick={() => { setMethod('delivery'); setTimingChoice('asap'); setRequestedTime('') }} disabled={submitting || Boolean(createdOrder)}><strong>Delivery</strong><span>Delivered to your address</span></button>}
              {restaurant.accepts_collection && <button className={method === 'collection' ? 'selected' : ''} type="button" onClick={() => { setMethod('collection'); setTimingChoice('asap'); setRequestedTime('') }} disabled={submitting || Boolean(createdOrder)}><strong>Collection</strong><span>Collect from the restaurant</span></button>}
            </div>
            {scheduledOrdersEnabled ? <div className="fulfilment-timing"><div><strong>When would you like it?</strong><span>The earliest {method} is in about {defaultMinutes} minutes.</span></div><div className="fulfilment-time-options"><button className={timingChoice === 'asap' ? 'selected' : ''} type="button" onClick={() => { setTimingChoice('asap'); setRequestedTime('') }} disabled={submitting || Boolean(createdOrder)}><strong>ASAP</strong><span>About {dateTime.format(minimumRequestedTime)}</span></button><button className={timingChoice === 'later' ? 'selected' : ''} type="button" onClick={() => { setTimingChoice('later'); setRequestedTime((current) => current || localDateTimeValue(minimumRequestedTime)) }} disabled={submitting || Boolean(createdOrder)}><strong>Choose a later time</strong><span>Up to 7 days ahead</span></button></div>{timingChoice === 'later' && <label className="requested-time-field">Requested {method} time<input type="datetime-local" min={localDateTimeValue(minimumRequestedTime)} max={localDateTimeValue(maximumRequestedTime)} step="900" value={requestedTime} onChange={(event) => setRequestedTime(event.target.value)} required disabled={submitting || Boolean(createdOrder)} /><span>Times outside the restaurant's opening hours will not be available.</span></label>}</div> : <div className="fulfilment-timing"><div><strong>ASAP ordering</strong><span>Your estimated {method} time is about {defaultMinutes} minutes.</span></div></div>}
          </section>

          <section className="checkout-card"><span className="checkout-step">2</span><div className="checkout-section-heading"><h2>Your details</h2><p>We will use these details for order updates.</p></div><div className="checkout-fields two-column"><label>First name<input value={details.firstName} onChange={(event) => updateField('firstName', event.target.value)} required disabled={submitting || Boolean(createdOrder)} /></label><label>Last name<input value={details.lastName} onChange={(event) => updateField('lastName', event.target.value)} required disabled={submitting || Boolean(createdOrder)} /></label><label>Email<input type="email" value={details.email} onChange={(event) => updateField('email', event.target.value)} required disabled={signedIn || submitting || Boolean(createdOrder)} /></label><label>Mobile number<input type="tel" value={details.phone} onChange={(event) => updateField('phone', event.target.value)} required disabled={submitting || Boolean(createdOrder)} /></label></div></section>

          {method === 'delivery' && <section className="checkout-card"><span className="checkout-step">{addressStep}</span><div className="checkout-section-heading"><h2>Delivery address</h2><p>{signedIn && savedAddresses.length ? 'Choose a saved address or enter a different one.' : 'We will save this address to your account for next time.'}</p></div>{signedIn && savedAddresses.length > 0 && <div className="checkout-saved-addresses">{savedAddresses.map((address) => <button className={selectedAddressId === address.id ? 'selected' : ''} type="button" key={address.id} onClick={() => applyAddress(address)} disabled={submitting || Boolean(createdOrder)}><span className="checkout-address-radio" aria-hidden="true" /><span><strong>{address.label}{address.is_default ? ' · Default' : ''}</strong><small>{address.address_line_1}{address.address_line_2 ? `, ${address.address_line_2}` : ''}</small><small>{address.town_city}, {address.postcode}</small>{address.delivery_instructions && <small>Note: {address.delivery_instructions}</small>}</span></button>)}<button className={selectedAddressId === 'new' ? 'selected' : ''} type="button" onClick={chooseNewAddress} disabled={submitting || Boolean(createdOrder)}><span className="checkout-address-radio" aria-hidden="true" /><span><strong>Use a different address</strong><small>Enter another delivery address below</small></span></button><Link className="checkout-manage-addresses" to="/account/addresses">Manage saved addresses</Link></div>}<div className="checkout-fields"><label>Address line 1<input value={details.addressLine1} onChange={(event) => updateField('addressLine1', event.target.value)} required disabled={submitting || Boolean(createdOrder)} /></label><label>Address line 2 <span>Optional</span><input value={details.addressLine2} onChange={(event) => updateField('addressLine2', event.target.value)} disabled={submitting || Boolean(createdOrder)} /></label><div className="two-column"><label>Town or city<input value={details.town} onChange={(event) => updateField('town', event.target.value)} required disabled={submitting || Boolean(createdOrder)} /></label><label>Postcode<input value={details.postcode} onChange={(event) => updateField('postcode', formatPostcode(event.target.value))} required disabled={submitting || Boolean(createdOrder)} /></label></div><label>Delivery instructions <span>Optional</span><textarea value={details.instructions} onChange={(event) => updateField('instructions', event.target.value)} rows={3} placeholder="Door number, access instructions or anything the driver should know" disabled={submitting || Boolean(createdOrder)} /></label></div></section>}

          <section className="checkout-card"><span className="checkout-step">{accountStep}</span><div className="checkout-section-heading"><h2>{signedIn ? 'Your account' : 'Save your details'}</h2><p>{signedIn ? 'You are signed in. This order will appear in My orders.' : 'Create an account to save your details and see your full order history.'}</p></div>{signedIn ? <div className="payment-placeholder">Signed in as {details.email}</div> : <div className="checkout-account"><div className="checkout-account-tabs"><button type="button" className={accountMode === 'create' ? 'selected' : ''} onClick={() => setAccountMode('create')}>Create account</button><button type="button" className={accountMode === 'signin' ? 'selected' : ''} onClick={() => setAccountMode('signin')}>Already registered</button></div><div className="checkout-fields"><label>Password<input type="password" minLength={8} autoComplete={accountMode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting || Boolean(createdOrder)} /><span>At least 8 characters</span></label></div></div>}</section>

          <section className="checkout-card checkout-payment-placeholder"><span className="checkout-step">{paymentStep}</span><div className="checkout-section-heading"><h2>Payment</h2><p>You will be transferred to Stripe for secure card, Apple Pay or Google Pay payment.</p></div><div className="payment-placeholder">{createdOrder ? `Order #${createdOrder.order_number} is opening secure payment` : 'Payment details are entered securely on Stripe'}</div></section>

          {submitted && minimumShortfall > 0 && <p className="checkout-error">Add {money.format(minimumShortfall / 100)} more to meet the minimum order.</p>}
          {error && <p className="checkout-error">{error}</p>}
          {message && <p className="checkout-message">{message}</p>}
          <button className="checkout-submit" type="submit" disabled={minimumShortfall > 0 || submitting || Boolean(createdOrder)}>{submitting ? 'Opening secure payment…' : createdOrder ? `Order #${createdOrder.order_number} created` : `Pay securely · ${money.format(total / 100)}`}</button>
        </form>

        <aside className="checkout-summary">
          <span>Your order from</span>
          <h2>{restaurant.name}</h2>
          <div className="checkout-summary-lines">{basketLines.map((line) => <div key={line.line_id || line.id}><span>{line.quantity} × {line.name}{line.removed_ingredients?.map((ingredient) => <small key={ingredient.id}>No {ingredient.name}</small>)}{line.selected_extras?.map((extra) => <small key={extra.id}>+ {extra.quantity > 1 ? `${extra.quantity} × ` : ''}{extra.name}</small>)}{line.selected_modifier_groups?.flatMap((group) => group.options.map((option) => <small key={`${group.group_id}-${option.id}`}>{group.group_name}: {option.quantity > 1 ? `${option.quantity} × ` : ''}{option.name}</small>))}{line.special_instructions && <small>Note: {line.special_instructions}</small>}</span><strong>{money.format(((line.unit_price_pence ?? line.price_pence) * line.quantity) / 100)}</strong></div>)}</div>

          <div className="checkout-promotion">
            <label htmlFor="promotion-code">Promotion code</label>
            <div className="checkout-promotion-row">
              <input id="promotion-code" value={promotionCode} onChange={(event) => { setPromotionCode(event.target.value.toUpperCase()); setPromotionError(''); if (appliedPromotion) setAppliedPromotion(null) }} placeholder="Enter code" disabled={promotionBusy || submitting || Boolean(createdOrder)} />
              <button type="button" onClick={() => void applyPromotion()} disabled={!promotionCode.trim() || promotionBusy || submitting || Boolean(createdOrder)}>{promotionBusy ? 'Checking…' : appliedPromotion ? 'Reapply' : 'Apply'}</button>
            </div>
            {appliedPromotion && <div className="checkout-promotion-success"><span>✓ {appliedPromotion.name || appliedPromotion.code}</span><button type="button" onClick={() => { setAppliedPromotion(null); setPromotionCode(''); setPromotionError('') }}>Remove</button></div>}
            {promotionError && <p className="checkout-promotion-error">{promotionError}</p>}
          </div>

          <div className="checkout-summary-costs">
            <div><span>Subtotal</span><strong>{money.format((createdOrder?.subtotal_pence ?? subtotal) / 100)}</strong></div>
            {method === 'delivery' && <div><span>Delivery</span><strong>{(createdOrder?.delivery_fee_pence ?? deliveryFee) ? money.format((createdOrder?.delivery_fee_pence ?? deliveryFee) / 100) : 'Free'}</strong></div>}
            {(createdOrder?.service_fee_pence ?? serviceFee) > 0 && <div><span>Service fee</span><strong>{money.format((createdOrder?.service_fee_pence ?? serviceFee) / 100)}</strong></div>}
            {(createdOrder?.discount_pence ?? discount) > 0 && <div className="checkout-summary-discount"><span>Promotion{(createdOrder?.promotion_code ?? appliedPromotion?.code) ? ` · ${createdOrder?.promotion_code ?? appliedPromotion?.code}` : ''}</span><strong>-{money.format((createdOrder?.discount_pence ?? discount) / 100)}</strong></div>}
            <div className="checkout-summary-total"><span>Total</span><strong>{money.format((createdOrder?.total_pence ?? total) / 100)}</strong></div>
          </div>
          <p>{scheduledOrdersEnabled && timingChoice === 'later' && requestedDate ? `Requested ${method}: ${dateTime.format(requestedDate)}` : `Estimated ${method}: ${defaultMinutes} minutes`}</p>
        </aside>
      </div>
    </main>
  )
}
