import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type OpeningHours = {
  day_of_week: number
  is_closed: boolean
  open_time: string | null
  close_time: string | null
}

type RestaurantProfile = {
  id: string
  name: string
  slug: string
  email: string | null
  phone: string | null
  cuisines: string[]
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number
  delivery_fee_pence: number
  delivery_radius_miles: number | string
  delivery_preparation_time_minutes: number
  collection_preparation_time_minutes: number
  free_delivery_threshold_pence: number | null
  vat_registered: boolean
  vat_number: string | null
  updated_at: string
  location: {
    id?: string
    line1?: string
    line2?: string | null
    city?: string
    postcode?: string
  }
  opening_hours: OpeningHours[]
}

type DayForm = OpeningHours & { label: string }

type ProfileForm = {
  name: string
  email: string
  phone: string
  cuisines: string[]
  line1: string
  line2: string
  city: string
  postcode: string
  acceptsDelivery: boolean
  acceptsCollection: boolean
  minimumOrder: string
  deliveryFee: string
  deliveryRadius: string
  deliveryMinutes: string
  collectionMinutes: string
  freeDeliveryThreshold: string
  vatRegistered: boolean
  vatNumber: string
  openingHours: DayForm[]
}

const days: Array<{ day_of_week: number; label: string; open_time: string; close_time: string }> = [
  { day_of_week: 1, label: 'Monday', open_time: '09:00', close_time: '22:00' },
  { day_of_week: 2, label: 'Tuesday', open_time: '09:00', close_time: '22:00' },
  { day_of_week: 3, label: 'Wednesday', open_time: '09:00', close_time: '22:00' },
  { day_of_week: 4, label: 'Thursday', open_time: '09:00', close_time: '22:00' },
  { day_of_week: 5, label: 'Friday', open_time: '09:00', close_time: '23:00' },
  { day_of_week: 6, label: 'Saturday', open_time: '09:00', close_time: '23:00' },
  { day_of_week: 0, label: 'Sunday', open_time: '10:00', close_time: '21:00' },
]

const cuisineOptions = [
  'American', 'Bakery', 'Breakfast', 'British', 'Burgers', 'Chinese', 'Desserts',
  'European', 'Indian', 'Italian', 'Japanese', 'Kebab', 'Mexican', 'Pizza',
  'Seafood', 'Thai', 'Vegan', 'Vegetarian',
]

const moneyPattern = /^\d{1,6}(?:\.\d{0,2})?$/
const vatPattern = /^(?:GB)?\d{9}(?:\d{3})?$/

function penceToPounds(value: number | null) {
  return value === null ? '' : (value / 100).toFixed(2)
}

function poundsToPence(value: string) {
  return Math.round(Number.parseFloat(value) * 100)
}

function profileToForm(profile: RestaurantProfile): ProfileForm {
  return {
    name: profile.name,
    email: profile.email || '',
    phone: profile.phone || '',
    cuisines: profile.cuisines || [],
    line1: profile.location?.line1 || '',
    line2: profile.location?.line2 || '',
    city: profile.location?.city || '',
    postcode: profile.location?.postcode || '',
    acceptsDelivery: profile.accepts_delivery,
    acceptsCollection: profile.accepts_collection,
    minimumOrder: penceToPounds(profile.minimum_order_pence),
    deliveryFee: penceToPounds(profile.delivery_fee_pence),
    deliveryRadius: String(profile.delivery_radius_miles),
    deliveryMinutes: String(profile.delivery_preparation_time_minutes),
    collectionMinutes: String(profile.collection_preparation_time_minutes),
    freeDeliveryThreshold: penceToPounds(profile.free_delivery_threshold_pence),
    vatRegistered: profile.vat_registered,
    vatNumber: profile.vat_number || '',
    openingHours: days.map((day) => {
      const stored = profile.opening_hours?.find((entry) => entry.day_of_week === day.day_of_week)
      return {
        day_of_week: day.day_of_week,
        label: day.label,
        is_closed: stored?.is_closed ?? false,
        open_time: stored?.open_time || day.open_time,
        close_time: stored?.close_time || day.close_time,
      }
    }),
  }
}

export default function RestaurantProfileEditor({ restaurantId, canManage, onSaved }: { restaurantId: string; canManage: boolean; onSaved: () => Promise<void> }) {
  const [profile, setProfile] = useState<RestaurantProfile | null>(null)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [initialForm, setInitialForm] = useState<ProfileForm | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const dirty = useMemo(() => Boolean(form && initialForm && JSON.stringify(form) !== JSON.stringify(initialForm)), [form, initialForm])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_restaurant_profile', { p_restaurant_id: restaurantId })
    if (loadError) {
      setError(loadError.message)
      setProfile(null)
      setForm(null)
    } else {
      const nextProfile = data as RestaurantProfile
      const nextForm = profileToForm(nextProfile)
      setProfile(nextProfile)
      setForm(nextForm)
      setInitialForm(nextForm)
      setReason('')
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty || saving) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving])

  function update<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setError('')
    setMessage('')
    setForm((current) => current ? { ...current, [key]: value } : current)
  }

  function updateDay(dayOfWeek: number, patch: Partial<DayForm>) {
    if (!form) return
    update('openingHours', form.openingHours.map((day) => day.day_of_week === dayOfWeek ? { ...day, ...patch } : day))
  }

  function toggleCuisine(cuisine: string) {
    if (!form) return
    update('cuisines', form.cuisines.includes(cuisine) ? form.cuisines.filter((entry) => entry !== cuisine) : [...form.cuisines, cuisine])
  }

  function validate() {
    if (!form) return 'Restaurant details are not loaded.'
    if (form.name.trim().length < 2) return 'Enter the restaurant name.'
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'Enter a valid email address.'
    if (form.phone.trim().length < 7) return 'Enter a valid phone number.'
    if (!form.cuisines.length) return 'Choose at least one cuisine.'
    if (!form.line1.trim() || !form.city.trim() || !form.postcode.trim()) return 'Enter the full trading address.'
    if (!form.acceptsDelivery && !form.acceptsCollection) return 'Enable delivery, collection, or both.'
    if (!moneyPattern.test(form.minimumOrder) || !moneyPattern.test(form.deliveryFee)) return 'Enter valid minimum-order and delivery-fee amounts.'
    if (form.freeDeliveryThreshold && !moneyPattern.test(form.freeDeliveryThreshold)) return 'Enter a valid free-delivery threshold.'
    const deliveryMinutes = Number.parseInt(form.deliveryMinutes, 10)
    const collectionMinutes = Number.parseInt(form.collectionMinutes, 10)
    const radius = Number.parseFloat(form.deliveryRadius)
    if (deliveryMinutes < 5 || deliveryMinutes > 480 || collectionMinutes < 5 || collectionMinutes > 480) return 'Preparation times must be between 5 and 480 minutes.'
    if (!Number.isFinite(radius) || radius < 0 || radius > 100) return 'Delivery radius must be between 0 and 100 miles.'
    if (form.freeDeliveryThreshold && poundsToPence(form.freeDeliveryThreshold) <= poundsToPence(form.minimumOrder)) return 'Free delivery threshold must be higher than the minimum order.'
    const vatNumber = form.vatNumber.replace(/[\s-]/g, '').toUpperCase()
    if (form.vatRegistered && !vatPattern.test(vatNumber)) return 'Enter a valid UK VAT number.'
    const invalidDay = form.openingHours.find((day) => !day.is_closed && (!day.open_time || !day.close_time || day.open_time === day.close_time))
    if (invalidDay) return `${invalidDay.label} must have different opening and closing times.`
    if (reason.trim().length < 3) return 'Add a reason of at least 3 characters for the audit trail.'
    return ''
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!profile || !form || !canManage || saving || !dirty) return
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    const vatNumber = form.vatNumber.replace(/[\s-]/g, '').toUpperCase()
    const { data, error: saveError } = await supabase.rpc('update_platform_restaurant_profile', {
      p_restaurant_id: restaurantId,
      p_payload: {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        cuisines: form.cuisines,
        location: {
          line1: form.line1.trim(),
          line2: form.line2.trim() || null,
          city: form.city.trim(),
          postcode: form.postcode.trim().toUpperCase(),
        },
        accepts_delivery: form.acceptsDelivery,
        accepts_collection: form.acceptsCollection,
        minimum_order_pence: poundsToPence(form.minimumOrder),
        delivery_fee_pence: poundsToPence(form.deliveryFee),
        delivery_radius_miles: Number.parseFloat(form.deliveryRadius),
        delivery_preparation_time_minutes: Number.parseInt(form.deliveryMinutes, 10),
        collection_preparation_time_minutes: Number.parseInt(form.collectionMinutes, 10),
        free_delivery_threshold_pence: form.freeDeliveryThreshold ? poundsToPence(form.freeDeliveryThreshold) : null,
        vat_registered: form.vatRegistered,
        vat_number: form.vatRegistered ? vatNumber : null,
        opening_hours: form.openingHours.map(({ day_of_week, is_closed, open_time, close_time }) => ({ day_of_week, is_closed, open_time: is_closed ? null : open_time, close_time: is_closed ? null : close_time })),
      },
      p_reason: reason.trim(),
      p_expected_updated_at: profile.updated_at,
    })

    if (saveError) {
      setError(saveError.message)
    } else {
      const nextProfile = data as RestaurantProfile
      const nextForm = profileToForm(nextProfile)
      setProfile(nextProfile)
      setForm(nextForm)
      setInitialForm(nextForm)
      setReason('')
      setMessage('Restaurant profile and opening hours saved.')
      await onSaved()
    }
    setSaving(false)
  }

  if (loading) return <div className="panel-empty admin-profile-loading"><span className="gate-spinner" /><strong>Loading editable profile…</strong></div>
  if (!profile || !form) return <div className="admin-profile-error"><div className="admin-alert error" role="alert">{error || 'Restaurant profile unavailable.'}</div><button type="button" className="secondary-button" onClick={() => void load()}>Try again</button></div>

  const disabled = !canManage || saving

  return <form className="admin-profile-editor" onSubmit={(event) => void save(event)}>
    <div className="admin-profile-heading">
      <div><span className="admin-kicker">Edit on behalf of restaurant</span><h3>Restaurant profile and settings</h3><p>Changes are applied immediately and recorded in the audit log.</p></div>
      <div className="admin-profile-heading-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => void load()}>↻ Refresh</button>{canManage && <button type="submit" className="admin-primary-button" disabled={saving || !dirty}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>}</div>
    </div>

    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {message && <div className="admin-alert success" role="status">{message}</div>}
    {!canManage && <div className="read-only-notice"><strong>Read-only profile</strong><span>Your role can inspect these settings but cannot edit them.</span></div>}

    <section className="admin-profile-card">
      <header><div><h4>Trading details</h4><p>The business name, cuisine and contact information.</p></div><span className="profile-url">/{profile.slug}</span></header>
      <div className="admin-profile-grid">
        <label className="wide">Restaurant name<input maxLength={120} value={form.name} disabled={disabled} onChange={(event) => update('name', event.target.value)} required /></label>
        <label>Email address<input type="email" maxLength={254} value={form.email} disabled={disabled} onChange={(event) => update('email', event.target.value)} required /></label>
        <label>Phone number<input type="tel" maxLength={30} value={form.phone} disabled={disabled} onChange={(event) => update('phone', event.target.value)} required /></label>
      </div>
      <div className="admin-cuisine-grid">{cuisineOptions.map((cuisine) => <button type="button" key={cuisine} disabled={disabled} className={form.cuisines.includes(cuisine) ? 'selected' : ''} onClick={() => toggleCuisine(cuisine)}>{form.cuisines.includes(cuisine) ? '✓ ' : ''}{cuisine}</button>)}</div>
    </section>

    <section className="admin-profile-card">
      <header><div><h4>Trading address</h4><p>The main collection and delivery location.</p></div></header>
      <div className="admin-profile-grid">
        <label className="wide">Address line 1<input maxLength={160} value={form.line1} disabled={disabled} onChange={(event) => update('line1', event.target.value)} required /></label>
        <label className="wide">Address line 2 <small>Optional</small><input maxLength={160} value={form.line2} disabled={disabled} onChange={(event) => update('line2', event.target.value)} /></label>
        <label>Town or city<input maxLength={100} value={form.city} disabled={disabled} onChange={(event) => update('city', event.target.value)} required /></label>
        <label>Postcode<input maxLength={12} value={form.postcode} disabled={disabled} onChange={(event) => update('postcode', event.target.value.toUpperCase())} required /></label>
      </div>
    </section>

    <section className="admin-profile-card">
      <header><div><h4>Delivery and collection</h4><p>Services, charges and preparation times shown at checkout.</p></div></header>
      <div className="admin-service-options">
        <label className={form.acceptsDelivery ? 'selected' : ''}><input type="checkbox" checked={form.acceptsDelivery} disabled={disabled} onChange={(event) => update('acceptsDelivery', event.target.checked)} /><strong>Delivery</strong><span>Customers can order to an address.</span></label>
        <label className={form.acceptsCollection ? 'selected' : ''}><input type="checkbox" checked={form.acceptsCollection} disabled={disabled} onChange={(event) => update('acceptsCollection', event.target.checked)} /><strong>Collection</strong><span>Customers can collect their order.</span></label>
      </div>
      <div className="admin-profile-grid settings">
        <label>Minimum order (£)<input inputMode="decimal" value={form.minimumOrder} disabled={disabled} onChange={(event) => update('minimumOrder', event.target.value)} /></label>
        <label>Delivery fee (£)<input inputMode="decimal" value={form.deliveryFee} disabled={disabled || !form.acceptsDelivery} onChange={(event) => update('deliveryFee', event.target.value)} /></label>
        <label>Delivery radius (miles)<input type="number" min="0" max="100" step="0.1" value={form.deliveryRadius} disabled={disabled || !form.acceptsDelivery} onChange={(event) => update('deliveryRadius', event.target.value)} /></label>
        <label>Delivery preparation (minutes)<input type="number" min="5" max="480" value={form.deliveryMinutes} disabled={disabled || !form.acceptsDelivery} onChange={(event) => update('deliveryMinutes', event.target.value)} /></label>
        <label>Collection preparation (minutes)<input type="number" min="5" max="480" value={form.collectionMinutes} disabled={disabled || !form.acceptsCollection} onChange={(event) => update('collectionMinutes', event.target.value)} /></label>
        <label>Free delivery over (£) <small>Optional</small><input inputMode="decimal" value={form.freeDeliveryThreshold} disabled={disabled || !form.acceptsDelivery} onChange={(event) => update('freeDeliveryThreshold', event.target.value)} /></label>
      </div>
      <div className="admin-vat-row"><label><input type="checkbox" checked={form.vatRegistered} disabled={disabled} onChange={(event) => update('vatRegistered', event.target.checked)} /><strong>VAT registered</strong></label>{form.vatRegistered && <label>VAT number<input maxLength={14} value={form.vatNumber} disabled={disabled} onChange={(event) => update('vatNumber', event.target.value.toUpperCase())} placeholder="GB123456789" /></label>}</div>
    </section>

    <section className="admin-profile-card">
      <header><div><h4>Opening hours</h4><p>Customers can only request orders during these times.</p></div><button type="button" className="secondary-button compact" disabled={disabled} onClick={() => {
        const monday = form.openingHours.find((day) => day.day_of_week === 1)
        if (monday) update('openingHours', form.openingHours.map((day) => day.day_of_week >= 1 && day.day_of_week <= 5 ? { ...day, is_closed: monday.is_closed, open_time: monday.open_time, close_time: monday.close_time } : day))
      }}>Copy Monday to weekdays</button></header>
      <div className="admin-hours-list">{form.openingHours.map((day) => <div className={day.is_closed ? 'admin-hours-row closed' : 'admin-hours-row'} key={day.day_of_week}>
        <strong>{day.label}</strong>
        <label className="closed-check"><input type="checkbox" checked={day.is_closed} disabled={disabled} onChange={(event) => updateDay(day.day_of_week, { is_closed: event.target.checked })} /> Closed</label>
        <label>Opens<input type="time" value={day.open_time || ''} disabled={disabled || day.is_closed} onChange={(event) => updateDay(day.day_of_week, { open_time: event.target.value })} /></label>
        <label>Closes<input type="time" value={day.close_time || ''} disabled={disabled || day.is_closed} onChange={(event) => updateDay(day.day_of_week, { close_time: event.target.value })} /></label>
      </div>)}</div>
    </section>

    {canManage && <section className="admin-profile-save">
      <label>Reason for changes<textarea maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the audit trail…" required /></label>
      <div><button type="button" className="secondary-button" disabled={saving || !dirty} onClick={() => { if (initialForm) setForm(initialForm); setReason(''); setError(''); setMessage('') }}>Discard changes</button><button type="submit" className="admin-primary-button" disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save profile'}</button></div>
    </section>}
  </form>
}
