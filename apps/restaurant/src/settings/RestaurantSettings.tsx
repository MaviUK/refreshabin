import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type RestaurantSettingsRecord = {
  id: string
  name: string
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number
  delivery_fee_pence: number
  delivery_radius_miles: number | string
  preparation_time_minutes: number
  delivery_preparation_time_minutes: number
  collection_preparation_time_minutes: number
  free_delivery_threshold_pence: number | null
  vat_registered: boolean
  vat_number: string | null
  updated_at: string
}

type FormState = {
  acceptsDelivery: boolean
  acceptsCollection: boolean
  minimumOrder: string
  deliveryFee: string
  deliveryRadius: string
  deliveryPreparationTime: string
  collectionPreparationTime: string
  freeDeliveryThreshold: string
  vatRegistered: boolean
  vatNumber: string
}

const emptyForm: FormState = {
  acceptsDelivery: true,
  acceptsCollection: true,
  minimumOrder: '0.00',
  deliveryFee: '0.00',
  deliveryRadius: '3',
  deliveryPreparationTime: '30',
  collectionPreparationTime: '20',
  freeDeliveryThreshold: '',
  vatRegistered: false,
  vatNumber: '',
}

const moneyPattern = /^\d{1,6}(?:\.\d{0,2})?$/
const vatPattern = /^(?:GB)?\d{9}(?:\d{3})?$/

function poundsToPence(value: string) {
  return Math.round(Number.parseFloat(value) * 100)
}

function penceToPounds(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2)
}

function normaliseMoney(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value
}

function settingsToForm(record: RestaurantSettingsRecord): FormState {
  return {
    acceptsDelivery: record.accepts_delivery,
    acceptsCollection: record.accepts_collection,
    minimumOrder: penceToPounds(record.minimum_order_pence),
    deliveryFee: penceToPounds(record.delivery_fee_pence),
    deliveryRadius: String(record.delivery_radius_miles),
    deliveryPreparationTime: String(record.delivery_preparation_time_minutes ?? record.preparation_time_minutes),
    collectionPreparationTime: String(record.collection_preparation_time_minutes ?? record.preparation_time_minutes),
    freeDeliveryThreshold: penceToPounds(record.free_delivery_threshold_pence),
    vatRegistered: record.vat_registered,
    vatNumber: record.vat_number || '',
  }
}

export default function RestaurantSettings() {
  const navigate = useNavigate()
  const [restaurant, setRestaurant] = useState<RestaurantSettingsRecord | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [initialForm, setInitialForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialForm), [form, initialForm])

  useEffect(() => {
    void loadSettings()
  }, [])

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirty || saving) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [dirty, saving])

  async function loadSettings(background = false) {
    if (background) setRefreshing(true)
    else setLoading(true)
    setError('')

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      const user = userData.user

      if (userError || !user) {
        navigate('/login', { replace: true, state: { from: '/settings' } })
        return
      }

      const { data: membership, error: membershipError } = await supabase
        .from('restaurant_members')
        .select('restaurant_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (membershipError) throw membershipError
      if (!membership) {
        setRestaurant(null)
        return
      }

      const { data, error: settingsError } = await supabase
        .from('restaurants')
        .select('id, name, accepts_delivery, accepts_collection, minimum_order_pence, delivery_fee_pence, delivery_radius_miles, preparation_time_minutes, delivery_preparation_time_minutes, collection_preparation_time_minutes, free_delivery_threshold_pence, vat_registered, vat_number, updated_at')
        .eq('id', membership.restaurant_id)
        .single()

      if (settingsError) throw settingsError

      const record = data as RestaurantSettingsRecord
      const nextForm = settingsToForm(record)
      setRestaurant(record)
      setForm(nextForm)
      setInitialForm(nextForm)
      setSaved(false)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load restaurant settings.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false)
    setError('')
    setForm((current) => ({ ...current, [key]: value }))
  }

  function validateMoney(label: string, value: string, optional = false) {
    const trimmed = value.trim()
    if (optional && !trimmed) return ''
    if (!moneyPattern.test(trimmed)) return `${label} must be a valid amount with no more than two decimal places.`
    return ''
  }

  async function saveSettings() {
    if (!restaurant || saving || !dirty) return

    if (!form.acceptsDelivery && !form.acceptsCollection) {
      setError('Enable delivery, collection, or both before saving.')
      return
    }

    const moneyError = validateMoney('Minimum order', form.minimumOrder)
      || validateMoney('Delivery fee', form.deliveryFee)
      || validateMoney('Free delivery threshold', form.freeDeliveryThreshold, true)
    if (moneyError) {
      setError(moneyError)
      return
    }

    const deliveryPreparationTime = Number.parseInt(form.deliveryPreparationTime, 10)
    const collectionPreparationTime = Number.parseInt(form.collectionPreparationTime, 10)
    const deliveryRadius = Number.parseFloat(form.deliveryRadius)

    if (form.acceptsDelivery && (!Number.isInteger(deliveryPreparationTime) || deliveryPreparationTime < 5 || deliveryPreparationTime > 480)) {
      setError('Default delivery time must be a whole number between 5 and 480 minutes.')
      return
    }

    if (form.acceptsCollection && (!Number.isInteger(collectionPreparationTime) || collectionPreparationTime < 5 || collectionPreparationTime > 480)) {
      setError('Default collection time must be a whole number between 5 and 480 minutes.')
      return
    }

    if (form.acceptsDelivery && (!Number.isFinite(deliveryRadius) || deliveryRadius <= 0 || deliveryRadius > 100)) {
      setError('Delivery radius must be greater than 0 and no more than 100 miles.')
      return
    }

    const minimumOrderPence = poundsToPence(form.minimumOrder)
    const deliveryFeePence = poundsToPence(form.deliveryFee)
    const freeDeliveryPence = form.freeDeliveryThreshold.trim() ? poundsToPence(form.freeDeliveryThreshold) : null

    if (freeDeliveryPence !== null && freeDeliveryPence <= minimumOrderPence) {
      setError('Free delivery threshold must be higher than the minimum order.')
      return
    }

    const vatNumber = form.vatNumber.replace(/[\s-]/g, '').toUpperCase()
    if (form.vatRegistered && !vatPattern.test(vatNumber)) {
      setError('Enter a valid UK VAT number, for example GB123456789.')
      return
    }

    setSaving(true)
    setSaved(false)
    setError('')

    try {
      const updatedAt = new Date().toISOString()
      const { data, error: saveError } = await supabase
        .from('restaurants')
        .update({
          accepts_delivery: form.acceptsDelivery,
          accepts_collection: form.acceptsCollection,
          minimum_order_pence: minimumOrderPence,
          delivery_fee_pence: form.acceptsDelivery ? deliveryFeePence : 0,
          delivery_radius_miles: form.acceptsDelivery ? deliveryRadius : 0,
          preparation_time_minutes: form.acceptsDelivery ? deliveryPreparationTime : collectionPreparationTime,
          delivery_preparation_time_minutes: deliveryPreparationTime,
          collection_preparation_time_minutes: collectionPreparationTime,
          free_delivery_threshold_pence: form.acceptsDelivery ? freeDeliveryPence : null,
          vat_registered: form.vatRegistered,
          vat_number: form.vatRegistered ? vatNumber : null,
          updated_at: updatedAt,
        })
        .eq('id', restaurant.id)
        .eq('updated_at', restaurant.updated_at)
        .select('updated_at')
        .maybeSingle()

      if (saveError) throw saveError
      if (!data) {
        setError('These settings changed on another device. Refresh to load the latest version before saving again.')
        return
      }

      const nextForm: FormState = {
        ...form,
        minimumOrder: normaliseMoney(form.minimumOrder),
        deliveryFee: normaliseMoney(form.deliveryFee),
        freeDeliveryThreshold: form.freeDeliveryThreshold.trim() ? normaliseMoney(form.freeDeliveryThreshold) : '',
        vatNumber: form.vatRegistered ? vatNumber : '',
      }
      setForm(nextForm)
      setInitialForm(nextForm)
      setRestaurant((current) => current ? { ...current, updated_at: data.updated_at } : current)
      setSaved(true)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save restaurant settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <main className="portal-shell"><div className="menu-state-card">Loading restaurant settings…</div></main>
  }

  if (!restaurant) {
    return (
      <main className="portal-shell">
        <div className="menu-state-card">
          <span className="eyebrow">Order settings</span>
          <h1>Create your restaurant first.</h1>
          <p>Complete restaurant setup before configuring delivery and collection.</p>
          <Link className="primary-button button-link" to="/onboarding">Start setup</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurant.name} · Order settings</p>
        </div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="page-heading-row">
        <div>
          <span className="eyebrow">How customers order</span>
          <h1>Delivery and collection</h1>
          <p>Set the services, charges and timings customers see before they place an order.</p>
        </div>
        <div className="print-history-header-actions">
          <button className="secondary-button" type="button" disabled={refreshing || saving} onClick={() => void loadSettings(true)}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
          </button>
        </div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <div className="form-success" role="status">Restaurant settings saved.</div>}

      <section className="settings-layout">
        <div className="settings-main">
          <article className="settings-card">
            <div className="settings-card-heading"><div><h2>Order methods</h2><p>Choose how customers can receive their food.</p></div></div>
            <div className="service-option-grid">
              <label className={form.acceptsDelivery ? 'service-option selected' : 'service-option'}>
                <input type="checkbox" checked={form.acceptsDelivery} onChange={(event) => updateForm('acceptsDelivery', event.target.checked)} />
                <span className="service-option-icon">↗</span><strong>Delivery</strong><small>Send orders to the customer's address.</small>
              </label>
              <label className={form.acceptsCollection ? 'service-option selected' : 'service-option'}>
                <input type="checkbox" checked={form.acceptsCollection} onChange={(event) => updateForm('acceptsCollection', event.target.checked)} />
                <span className="service-option-icon">⌂</span><strong>Collection</strong><small>Customers collect directly from your restaurant.</small>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><div><h2>Pricing and fulfilment</h2><p>These values appear throughout the customer checkout.</p></div></div>
            <div className="settings-field-grid">
              <label className="settings-field"><span>Minimum order</span><div className="input-prefix"><span>£</span><input inputMode="decimal" value={form.minimumOrder} onChange={(event) => updateForm('minimumOrder', event.target.value)} /></div></label>
              <label className="settings-field"><span>Default delivery time</span><div className="input-suffix"><input type="number" min="5" max="480" step="1" value={form.deliveryPreparationTime} onChange={(event) => updateForm('deliveryPreparationTime', event.target.value)} disabled={!form.acceptsDelivery} /><span>minutes</span></div><small>Earliest delivery customers can request.</small></label>
              <label className="settings-field"><span>Default collection time</span><div className="input-suffix"><input type="number" min="5" max="480" step="1" value={form.collectionPreparationTime} onChange={(event) => updateForm('collectionPreparationTime', event.target.value)} disabled={!form.acceptsCollection} /><span>minutes</span></div><small>Earliest collection customers can request.</small></label>
              <label className="settings-field"><span>Delivery fee</span><div className="input-prefix"><span>£</span><input inputMode="decimal" value={form.deliveryFee} onChange={(event) => updateForm('deliveryFee', event.target.value)} disabled={!form.acceptsDelivery} /></div></label>
              <label className="settings-field"><span>Delivery radius</span><div className="input-suffix"><input type="number" min="0.1" max="100" step="0.1" value={form.deliveryRadius} onChange={(event) => updateForm('deliveryRadius', event.target.value)} disabled={!form.acceptsDelivery} /><span>miles</span></div></label>
              <label className="settings-field settings-field-wide"><span>Free delivery threshold <small>Optional</small></span><div className="input-prefix"><span>£</span><input inputMode="decimal" placeholder="Leave blank to disable" value={form.freeDeliveryThreshold} onChange={(event) => updateForm('freeDeliveryThreshold', event.target.value)} disabled={!form.acceptsDelivery} /></div></label>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <div><h2>VAT details</h2><p>Store the VAT status shown on receipts and invoices.</p></div>
              <label className="switch-control"><input type="checkbox" checked={form.vatRegistered} onChange={(event) => updateForm('vatRegistered', event.target.checked)} /><span /></label>
            </div>
            {form.vatRegistered && <label className="settings-field settings-field-wide"><span>VAT number</span><input className="standard-input" autoCapitalize="characters" placeholder="GB123456789" value={form.vatNumber} onChange={(event) => updateForm('vatNumber', event.target.value)} /></label>}
          </article>
        </div>

        <aside className="settings-summary-card">
          <span className="eyebrow">Customer preview</span><h2>What customers will see</h2>
          <div className="summary-service-list">
            {form.acceptsDelivery && <div><strong>Delivery</strong><span>{moneyPattern.test(form.deliveryFee) && poundsToPence(form.deliveryFee) === 0 ? 'Free' : `£${form.deliveryFee || '0.00'}`} · {form.deliveryRadius || '0'} miles</span></div>}
            {form.acceptsCollection && <div><strong>Collection</strong><span>Available</span></div>}
            {form.acceptsDelivery && <div><strong>Delivery</strong><span>From {form.deliveryPreparationTime || '0'} minutes</span></div>}
            {form.acceptsCollection && <div><strong>Collection</strong><span>From {form.collectionPreparationTime || '0'} minutes</span></div>}
            <div><strong>Minimum order</strong><span>£{form.minimumOrder || '0.00'}</span></div>
          </div>
          {form.acceptsDelivery && form.freeDeliveryThreshold && <div className="summary-highlight">Free delivery on orders over £{form.freeDeliveryThreshold}</div>}
          {dirty && <div className="summary-highlight">You have unsaved changes.</div>}
          <Link className="secondary-button button-link full-width-button" to="/opening-hours">Review opening hours</Link>
          <Link className="secondary-button button-link full-width-button" to="/delivery-areas">Review delivery areas</Link>
        </aside>
      </section>

      <div className="mobile-save-bar">
        <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}</button>
      </div>
    </main>
  )
}
