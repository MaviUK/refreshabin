import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type DeliveryArea = {
  id: string
  restaurant_id: string
  postcode_prefix: string
  delivery_fee_pence: number | null
  minimum_order_pence: number | null
  is_active: boolean
}

type Restaurant = {
  id: string
  name: string
  delivery_fee_pence: number
  minimum_order_pence: number
}

function poundsToPence(value: string) {
  const amount = Number.parseFloat(value)
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : null
}

function formatMoney(value: number | null, fallback: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format((value ?? fallback) / 100)
}

function normalisePrefix(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

export default function DeliveryAreas() {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [areas, setAreas] = useState<DeliveryArea[]>([])
  const [postcode, setPostcode] = useState('')
  const [fee, setFee] = useState('')
  const [minimumOrder, setMinimumOrder] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void loadPage()
  }, [])

  const activeCount = useMemo(() => areas.filter((area) => area.is_active).length, [areas])

  async function loadPage() {
    setLoading(true)
    setError('')

    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) {
      setError('Your session has expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id')
      .eq('user_id', authData.user.id)
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

    const [{ data: restaurantData, error: restaurantError }, { data: areaData, error: areaError }] = await Promise.all([
      supabase
        .from('restaurants')
        .select('id, name, delivery_fee_pence, minimum_order_pence')
        .eq('id', membership.restaurant_id)
        .single(),
      supabase
        .from('restaurant_service_postcodes')
        .select('id, restaurant_id, postcode_prefix, delivery_fee_pence, minimum_order_pence, is_active')
        .eq('restaurant_id', membership.restaurant_id)
        .order('postcode_prefix'),
    ])

    if (restaurantError || areaError) {
      setError(restaurantError?.message || areaError?.message || 'Unable to load delivery areas.')
      setLoading(false)
      return
    }

    setRestaurant(restaurantData as Restaurant)
    setAreas((areaData || []) as DeliveryArea[])
    setLoading(false)
  }

  async function addArea(event: FormEvent) {
    event.preventDefault()
    if (!restaurant) return

    const prefix = normalisePrefix(postcode)
    if (prefix.length < 2) {
      setError('Enter at least the first two characters of a postcode area.')
      return
    }

    if (areas.some((area) => area.postcode_prefix === prefix)) {
      setError(`${prefix} is already in your delivery areas.`)
      return
    }

    setSaving(true)
    setError('')

    const { data, error: insertError } = await supabase
      .from('restaurant_service_postcodes')
      .insert({
        restaurant_id: restaurant.id,
        postcode_prefix: prefix,
        delivery_fee_pence: fee.trim() ? poundsToPence(fee) : null,
        minimum_order_pence: minimumOrder.trim() ? poundsToPence(minimumOrder) : null,
      })
      .select('id, restaurant_id, postcode_prefix, delivery_fee_pence, minimum_order_pence, is_active')
      .single()

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setAreas((current) => [...current, data as DeliveryArea].sort((a, b) => a.postcode_prefix.localeCompare(b.postcode_prefix)))
    setPostcode('')
    setFee('')
    setMinimumOrder('')
  }

  async function toggleArea(area: DeliveryArea) {
    const { error: updateError } = await supabase
      .from('restaurant_service_postcodes')
      .update({ is_active: !area.is_active, updated_at: new Date().toISOString() })
      .eq('id', area.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setAreas((current) => current.map((item) => item.id === area.id ? { ...item, is_active: !item.is_active } : item))
  }

  async function removeArea(area: DeliveryArea) {
    if (!window.confirm(`Remove ${area.postcode_prefix} from your delivery areas?`)) return

    const { error: deleteError } = await supabase
      .from('restaurant_service_postcodes')
      .delete()
      .eq('id', area.id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setAreas((current) => current.filter((item) => item.id !== area.id))
  }

  if (loading) {
    return <main className="portal-shell"><div className="menu-state-card">Loading delivery areas…</div></main>
  }

  if (!restaurant) {
    return (
      <main className="portal-shell">
        <div className="menu-state-card">
          <h1>Create your restaurant first</h1>
          <p>Complete onboarding before adding delivery areas.</p>
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
          <p className="dashboard-kicker">{restaurant.name} · Delivery areas</p>
        </div>
        <Link className="secondary-button button-link" to="/settings">Order settings</Link>
      </header>

      <section className="page-heading-row">
        <div>
          <span className="eyebrow">Delivery coverage</span>
          <h1>Postcode delivery areas</h1>
          <p>Add outward postcode areas such as BT18, BT19 or SW1. Leave prices blank to use your restaurant defaults.</p>
        </div>
        <div className="metric-card compact-metric"><span>Active areas</span><strong>{activeCount}</strong></div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="settings-layout">
        <div className="settings-main">
          <article className="settings-card">
            <div className="settings-card-heading">
              <div><h2>Add an area</h2><p>Use a postcode prefix rather than a complete customer postcode.</p></div>
            </div>

            <form className="settings-field-grid" onSubmit={(event) => void addArea(event)}>
              <label className="settings-field">
                <span>Postcode prefix</span>
                <input className="standard-input" value={postcode} onChange={(event) => setPostcode(normalisePrefix(event.target.value))} placeholder="BT18" autoComplete="postal-code" />
              </label>
              <label className="settings-field">
                <span>Delivery fee <small>Optional override</small></span>
                <div className="input-prefix"><span>£</span><input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} placeholder={(restaurant.delivery_fee_pence / 100).toFixed(2)} /></div>
              </label>
              <label className="settings-field">
                <span>Minimum order <small>Optional override</small></span>
                <div className="input-prefix"><span>£</span><input inputMode="decimal" value={minimumOrder} onChange={(event) => setMinimumOrder(event.target.value)} placeholder={(restaurant.minimum_order_pence / 100).toFixed(2)} /></div>
              </label>
              <div className="settings-field form-action-field">
                <span>&nbsp;</span>
                <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add delivery area'}</button>
              </div>
            </form>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <div><h2>Your delivery areas</h2><p>Pause an area temporarily or remove it completely.</p></div>
            </div>

            {areas.length === 0 ? (
              <div className="empty-state"><strong>No postcode areas yet</strong><p>Add your first area above to begin postcode-based delivery checks.</p></div>
            ) : (
              <div className="delivery-area-list">
                {areas.map((area) => (
                  <div className={area.is_active ? 'delivery-area-row' : 'delivery-area-row inactive'} key={area.id}>
                    <div className="postcode-badge">{area.postcode_prefix}</div>
                    <div className="delivery-area-details">
                      <strong>{area.is_active ? 'Delivery available' : 'Paused'}</strong>
                      <span>Fee {formatMoney(area.delivery_fee_pence, restaurant.delivery_fee_pence)} · Minimum {formatMoney(area.minimum_order_pence, restaurant.minimum_order_pence)}</span>
                    </div>
                    <div className="delivery-area-actions">
                      <button className="text-button" type="button" onClick={() => void toggleArea(area)}>{area.is_active ? 'Pause' : 'Enable'}</button>
                      <button className="text-button danger-text" type="button" onClick={() => void removeArea(area)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        <aside className="settings-summary-card">
          <span className="eyebrow">How it works</span>
          <h2>Customer postcode check</h2>
          <p>At checkout, ordered.food will match the customer's postcode against these active prefixes.</p>
          <div className="summary-service-list">
            <div><strong>Default fee</strong><span>{formatMoney(null, restaurant.delivery_fee_pence)}</span></div>
            <div><strong>Default minimum</strong><span>{formatMoney(null, restaurant.minimum_order_pence)}</span></div>
            <div><strong>Active prefixes</strong><span>{activeCount}</span></div>
          </div>
          <Link className="secondary-button button-link full-width-button" to="/settings">Edit default charges</Link>
        </aside>
      </section>
    </main>
  )
}
