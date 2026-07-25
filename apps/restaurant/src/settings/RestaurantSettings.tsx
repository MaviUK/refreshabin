import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  free_delivery_threshold_pence: number | null
  vat_registered: boolean
  vat_number: string | null
}

type FormState = {
  acceptsDelivery: boolean
  acceptsCollection: boolean
  minimumOrder: string
  deliveryFee: string
  deliveryRadius: string
  preparationTime: string
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
  preparationTime: '25',
  freeDeliveryThreshold: '',
  vatRegistered: false,
  vatNumber: '',
}

function poundsToPence(value: string) {
  const amount = Number.parseFloat(value || '0')
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0
}

function penceToPounds(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2)
}

export default function RestaurantSettings() {
  const [restaurant, setRestaurant] = useState<RestaurantSettingsRecord | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)
    setError('')

    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user

    if (!user) {
      setError('Your session has expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (membershipError) {
      setError(membershipError.message)
      setLoading(false)
      return
    }

    if (!membership) {
      setLoading(false)
      return
    }

    const { data, error: settingsError } = await supabase
      .from('restaurants')
      .select('id, name, accepts_delivery, accepts_collection, minimum_order_pence, delivery_fee_pence, delivery_radius_miles, preparation_time_minutes, free_delivery_threshold_pence, vat_registered, vat_number')
      .eq('id', membership.restaurant_id)
      .single()

    if (settingsError) {
      setError(settingsError.message)
      setLoading(false)
      return
    }

    const record = data as RestaurantSettingsRecord
    setRestaurant(record)
    setForm({
      acceptsDelivery: record.accepts_delivery,
      acceptsCollection: record.accepts_collection,
      minimumOrder: penceToPounds(record.minimum_order_pence),
      deliveryFee: penceToPounds(record.delivery_fee_pence),
      deliveryRadius: String(record.delivery_radius_miles),
      preparationTime: String(record.preparation_time_minutes),
      freeDeliveryThreshold: penceToPounds(record.free_delivery_threshold_pence),
      vatRegistered: record.vat_registered,
      vatNumber: record.vat_number || '',
    })
    setLoading(false)
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setSaved(false)
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function saveSettings() {
    if (!restaurant) return

    if (!form.acceptsDelivery && !form.acceptsCollection) {
      setError('Enable delivery, collection, or both before saving.')
      return
    }

    const preparationTime = Number.parseInt(form.preparationTime, 10)
    const deliveryRadius = Number.parseFloat(form.deliveryRadius)

    if (!Number.isFinite(preparationTime) || preparationTime < 5 || preparationTime > 240) {
      setError('Preparation time must be between 5 and 240 minutes.')
      return
    }

    if (form.acceptsDelivery && (!Number.isFinite(deliveryRadius) || deliveryRadius < 0)) {
      setError('Enter a valid delivery radius.')
      return
    }

    setSaving(true)
    setSaved(false)
    setError('')

    const { error: saveError } = await supabase
      .from('restaurants')
      .update({
        accepts_delivery: form.acceptsDelivery,
        accepts_collection: form.acceptsCollection,
        minimum_order_pence: poundsToPence(form.minimumOrder),
        delivery_fee_pence: poundsToPence(form.deliveryFee),
        delivery_radius_miles: Number.parseFloat(form.deliveryRadius || '0'),
        preparation_time_minutes: preparationTime,
        free_delivery_threshold_pence: form.freeDeliveryThreshold.trim() ? poundsToPence(form.freeDeliveryThreshold) : null,
        vat_registered: form.vatRegistered,
        vat_number: form.vatRegistered && form.vatNumber.trim() ? form.vatNumber.trim().toUpperCase() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', restaurant.id)

    setSaving(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    setSaved(true)
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
        <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <div className="form-success" role="status">Restaurant settings saved.</div>}

      <section className="settings-layout">
        <div className="settings-main">
          <article className="settings-card">
            <div className="settings-card-heading">
              <div>
                <h2>Order methods</h2>
                <p>Choose how customers can receive their food.</p>
              </div>
            </div>

            <div className="service-option-grid">
              <label className={form.acceptsDelivery ? 'service-option selected' : 'service-option'}>
                <input type="checkbox" checked={form.acceptsDelivery} onChange={(event) => updateForm('acceptsDelivery', event.target.checked)} />
                <span className="service-option-icon">↗</span>
                <strong>Delivery</strong>
                <small>Send orders to the customer's address.</small>
              </label>

              <label className={form.acceptsCollection ? 'service-option selected' : 'service-option'}>
                <input type="checkbox" checked={form.acceptsCollection} onChange={(event) => updateForm('acceptsCollection', event.target.checked)} />
                <span className="service-option-icon">⌂</span>
                <strong>Collection</strong>
                <small>Customers collect directly from your restaurant.</small>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <div>
                <h2>Pricing and fulfilment</h2>
                <p>These values appear throughout the customer checkout.</p>
              </div>
            </div>

            <div className="settings-field-grid">
              <label className="settings-field">
                <span>Minimum order</span>
                <div className="input-prefix"><span>£</span><input inputMode="decimal" value={form.minimumOrder} onChange={(event) => updateForm('minimumOrder', event.target.value)} /></div>
              </label>

              <label className="settings-field">
                <span>Preparation time</span>
                <div className="input-suffix"><input type="number" min="5" max="240" value={form.preparationTime} onChange={(event) => updateForm('preparationTime', event.target.value)} /><span>minutes</span></div>
              </label>

              <label className="settings-field">
                <span>Delivery fee</span>
                <div className="input-prefix"><span>£</span><input inputMode="decimal" value={form.deliveryFee} onChange={(event) => updateForm('deliveryFee', event.target.value)} disabled={!form.acceptsDelivery} /></div>
              </label>

              <label className="settings-field">
                <span>Delivery radius</span>
                <div className="input-suffix"><input type="number" min="0" step="0.1" value={form.deliveryRadius} onChange={(event) => updateForm('deliveryRadius', event.target.value)} disabled={!form.acceptsDelivery} /><span>miles</span></div>
              </label>

              <label className="settings-field settings-field-wide">
                <span>Free delivery threshold <small>Optional</small></span>
                <div className="input-prefix"><span>£</span><input inputMode="decimal" placeholder="Leave blank to disable" value={form.freeDeliveryThreshold} onChange={(event) => updateForm('freeDeliveryThreshold', event.target.value)} disabled={!form.acceptsDelivery} /></div>
              </label>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <div>
                <h2>VAT details</h2>
                <p>Store the VAT status shown on receipts and invoices.</p>
              </div>
              <label className="switch-control">
                <input type="checkbox" checked={form.vatRegistered} onChange={(event) => updateForm('vatRegistered', event.target.checked)} />
                <span />
              </label>
            </div>

            {form.vatRegistered && (
              <label className="settings-field settings-field-wide">
                <span>VAT number</span>
                <input className="standard-input" placeholder="GB123456789" value={form.vatNumber} onChange={(event) => updateForm('vatNumber', event.target.value)} />
              </label>
            )}
          </article>
        </div>

        <aside className="settings-summary-card">
          <span className="eyebrow">Customer preview</span>
          <h2>What customers will see</h2>
          <div className="summary-service-list">
            {form.acceptsDelivery && (
              <div><strong>Delivery</strong><span>{poundsToPence(form.deliveryFee) === 0 ? 'Free' : `£${form.deliveryFee || '0.00'}`} · {form.deliveryRadius || '0'} miles</span></div>
            )}
            {form.acceptsCollection && <div><strong>Collection</strong><span>Available</span></div>}
            <div><strong>Ready in</strong><span>{form.preparationTime || '0'} minutes</span></div>
            <div><strong>Minimum order</strong><span>£{form.minimumOrder || '0.00'}</span></div>
          </div>
          {form.acceptsDelivery && form.freeDeliveryThreshold && (
            <div className="summary-highlight">Free delivery on orders over £{form.freeDeliveryThreshold}</div>
          )}
          <Link className="secondary-button button-link full-width-button" to="/opening-hours">Review opening hours</Link>
        </aside>
      </section>

      <div className="mobile-save-bar">
        <button className="primary-button" type="button" onClick={() => void saveSettings()} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </main>
  )
}
