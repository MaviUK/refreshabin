import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Restaurant = {
  id: string
  name: string
  cuisines: string[] | null
  email: string | null
  phone: string | null
}

type Location = {
  id: string
  line1: string
  line2: string | null
  city: string
  postcode: string
}

const cuisineOptions = [
  'American', 'Bakery', 'Breakfast', 'British', 'Burgers', 'Chinese', 'Desserts',
  'European', 'Indian', 'Italian', 'Japanese', 'Kebab', 'Mexican', 'Pizza',
  'Seafood', 'Thai', 'Vegan', 'Vegetarian',
]

export default function RestaurantDetails() {
  const navigate = useNavigate()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [cuisines, setCuisines] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')

  useEffect(() => {
    async function loadDetails() {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          navigate('/login', { replace: true, state: { from: '/restaurant-details' } })
          return
        }

        const { data: membership, error: membershipError } = await supabase
          .from('restaurant_members')
          .select('restaurant_id,restaurants(id,name,cuisines,email,phone)')
          .eq('user_id', userData.user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (membershipError) throw membershipError
        const relation = membership?.restaurants
        const restaurantValue = (Array.isArray(relation) ? relation[0] : relation) as Restaurant | null
        if (!membership || !restaurantValue) throw new Error('Restaurant details could not be loaded.')

        const { data: locationValue, error: locationError } = await supabase
          .from('restaurant_locations')
          .select('id,line1,line2,city,postcode')
          .eq('restaurant_id', membership.restaurant_id)
          .eq('is_primary', true)
          .limit(1)
          .maybeSingle()
        if (locationError) throw locationError

        const primaryLocation = locationValue as Location | null
        setRestaurant(restaurantValue)
        setLocation(primaryLocation)
        setName(restaurantValue.name || '')
        setCuisines(restaurantValue.cuisines || [])
        setEmail(restaurantValue.email || '')
        setPhone(restaurantValue.phone || '')
        setLine1(primaryLocation?.line1 || '')
        setLine2(primaryLocation?.line2 || '')
        setCity(primaryLocation?.city || '')
        setPostcode(primaryLocation?.postcode || '')
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load restaurant details.')
      } finally {
        setLoading(false)
      }
    }

    void loadDetails()
  }, [navigate])

  async function saveDetails() {
    if (!restaurant) return
    setSaved(false)
    setError('')
    if (!name.trim() || !cuisines.length || !email.trim() || !phone.trim()) {
      setError('Enter the restaurant name, cuisine, email address and phone number.')
      return
    }
    if (!line1.trim() || !city.trim() || !postcode.trim()) {
      setError('Enter the full trading address.')
      return
    }

    setSaving(true)
    try {
      const { error: restaurantError } = await supabase
        .from('restaurants')
        .update({
          name: name.trim(), cuisines, email: email.trim(), phone: phone.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', restaurant.id)
      if (restaurantError) throw restaurantError

      const locationRow = {
        restaurant_id: restaurant.id,
        name: 'Main location',
        line1: line1.trim(),
        line2: line2.trim() || null,
        city: city.trim(),
        postcode: postcode.trim().toUpperCase(),
        timezone: 'Europe/London',
        is_primary: true,
        is_active: true,
        updated_at: new Date().toISOString(),
      }
      const locationQuery = location
        ? supabase.from('restaurant_locations').update(locationRow).eq('id', location.id)
        : supabase.from('restaurant_locations').insert(locationRow)
      const { data: savedLocation, error: locationError } = await locationQuery
        .select('id,line1,line2,city,postcode')
        .single()
      if (locationError) throw locationError
      setLocation(savedLocation as Location)
      setPostcode(postcode.trim().toUpperCase())
      setSaved(true)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save restaurant details.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <main className="portal-shell"><div className="menu-state-card">Loading restaurant details…</div></main>

  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p className="dashboard-kicker">{name || 'Your restaurant'} · Details</p></div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="page-heading-row">
        <div><span className="eyebrow">Restaurant details</span><h1>Your restaurant profile</h1><p>Keep the trading details customers and ordered.food use up to date.</p></div>
        <button className="primary-button" type="button" onClick={() => void saveDetails()} disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <div className="form-success" role="status">Restaurant details saved.</div>}

      <section className="settings-layout">
        <div className="settings-main">
          <article className="settings-card">
            <div className="settings-card-heading"><div><h2>Trading details</h2><p>The name and cuisine shown on your storefront.</p></div></div>
            <div className="form-grid">
              <label className="large-field full-width">Restaurant name<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} /></label>
            </div>
            <div className="cuisine-grid">
              {cuisineOptions.map((cuisine) => <button className={cuisines.includes(cuisine) ? 'cuisine-chip selected' : 'cuisine-chip'} type="button" key={cuisine} onClick={() => { setCuisines((current) => current.includes(cuisine) ? current.filter((item) => item !== cuisine) : [...current, cuisine]); setSaved(false) }}>{cuisines.includes(cuisine) ? '✓ ' : ''}{cuisine}</button>)}
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><div><h2>Contact details</h2><p>Used for application and order communication.</p></div></div>
            <div className="form-grid">
              <label className="large-field">Email address<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setSaved(false) }} /></label>
              <label className="large-field">Phone number<input type="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setSaved(false) }} /></label>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><div><h2>Trading address</h2><p>Your main collection and delivery location.</p></div></div>
            <div className="form-grid">
              <label className="large-field full-width">Address line 1<input value={line1} onChange={(event) => { setLine1(event.target.value); setSaved(false) }} /></label>
              <label className="large-field full-width">Address line 2 <span className="optional-label">Optional</span><input value={line2} onChange={(event) => { setLine2(event.target.value); setSaved(false) }} /></label>
              <label className="large-field">Town or city<input value={city} onChange={(event) => { setCity(event.target.value); setSaved(false) }} /></label>
              <label className="large-field">Postcode<input value={postcode} onChange={(event) => { setPostcode(event.target.value.toUpperCase()); setSaved(false) }} /></label>
            </div>
          </article>
        </div>
        <aside className="settings-summary-card"><span className="eyebrow">Related settings</span><h2>Restaurant setup</h2><p>Manage the other information shown to customers.</p><Link className="secondary-button button-link full-width-button" to="/opening-hours">Review opening hours</Link><Link className="secondary-button button-link full-width-button" to="/branding">Review branding</Link><Link className="secondary-button button-link full-width-button" to="/settings">Delivery and collection</Link></aside>
      </section>

      <div className="mobile-save-bar"><button className="primary-button" type="button" onClick={() => void saveDetails()} disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button></div>
    </main>
  )
}
