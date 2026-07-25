import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

declare global {
  interface Window {
    google?: any
    __orderedGoogleMapsPromise?: Promise<void>
  }
}

type Restaurant = {
  id: string
  name: string
  delivery_radius_miles: number | string
  delivery_fee_pence: number
  minimum_order_pence: number
}

type Location = {
  address_line1: string
  address_line2: string | null
  city: string
  postcode: string
}

const MILES_TO_METRES = 1609.344

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve()
  if (window.__orderedGoogleMapsPromise) return window.__orderedGoogleMapsPromise

  window.__orderedGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry,places&v=weekly`
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Maps could not be loaded.'))
    document.head.appendChild(script)
  })

  return window.__orderedGoogleMapsPromise
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

export default function DeliveryMap() {
  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapInstance = useRef<any>(null)
  const markerInstance = useRef<any>(null)
  const circleInstance = useRef<any>(null)

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [radius, setRadius] = useState('3')
  const [loading, setLoading] = useState(true)
  const [mapLoading, setMapLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void loadRestaurant()
  }, [])

  useEffect(() => {
    if (!restaurant || !location || !mapElement.current) return
    void initialiseMap()
  }, [restaurant, location])

  useEffect(() => {
    const miles = Number.parseFloat(radius)
    if (circleInstance.current && Number.isFinite(miles)) {
      circleInstance.current.setRadius(Math.max(0, miles) * MILES_TO_METRES)
      if (mapInstance.current && miles > 0) {
        const bounds = circleInstance.current.getBounds()
        if (bounds) mapInstance.current.fitBounds(bounds, 48)
      }
    }
  }, [radius])

  async function loadRestaurant() {
    setLoading(true)
    setError('')

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setError('Your session has expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id')
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (membershipError || !membership) {
      setError(membershipError?.message || 'Create your restaurant before configuring a delivery map.')
      setLoading(false)
      return
    }

    const [{ data: restaurantData, error: restaurantError }, { data: locationData, error: locationError }] = await Promise.all([
      supabase
        .from('restaurants')
        .select('id, name, delivery_radius_miles, delivery_fee_pence, minimum_order_pence')
        .eq('id', membership.restaurant_id)
        .single(),
      supabase
        .from('restaurant_locations')
        .select('address_line1, address_line2, city, postcode')
        .eq('restaurant_id', membership.restaurant_id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (restaurantError || locationError || !locationData) {
      setError(restaurantError?.message || locationError?.message || 'No restaurant address was found.')
      setLoading(false)
      return
    }

    const record = restaurantData as Restaurant
    setRestaurant(record)
    setLocation(locationData as Location)
    setRadius(String(record.delivery_radius_miles ?? 3))
    setLoading(false)
  }

  async function initialiseMap() {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
    if (!apiKey) {
      setError('Add VITE_GOOGLE_MAPS_API_KEY to the restaurant app environment to enable the map.')
      return
    }

    setMapLoading(true)
    try {
      await loadGoogleMaps(apiKey)
      if (!mapElement.current || !location || !restaurant) return

      const address = [location.address_line1, location.address_line2, location.city, location.postcode, 'United Kingdom']
        .filter(Boolean)
        .join(', ')
      const geocoder = new window.google.maps.Geocoder()
      const result = await geocoder.geocode({ address, region: 'GB' })
      const centre = result.results[0]?.geometry?.location

      if (!centre) throw new Error('Google could not find the restaurant address.')

      const map = new window.google.maps.Map(mapElement.current, {
        center: centre,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })

      const marker = new window.google.maps.Marker({
        map,
        position: centre,
        title: restaurant.name,
        draggable: false,
      })

      const circle = new window.google.maps.Circle({
        map,
        center: centre,
        radius: Math.max(0, Number.parseFloat(radius) || 0) * MILES_TO_METRES,
        fillColor: '#ed3978',
        fillOpacity: 0.18,
        strokeColor: '#c72f68',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        editable: true,
        draggable: false,
      })

      circle.addListener('radius_changed', () => {
        const miles = circle.getRadius() / MILES_TO_METRES
        setRadius(miles.toFixed(1))
        setSaved(false)
      })

      map.fitBounds(circle.getBounds(), 48)
      mapInstance.current = map
      markerInstance.current = marker
      circleInstance.current = circle
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : 'Unable to initialise Google Maps.')
    } finally {
      setMapLoading(false)
    }
  }

  async function saveRadius() {
    if (!restaurant) return
    const miles = Number.parseFloat(radius)
    if (!Number.isFinite(miles) || miles <= 0 || miles > 100) {
      setError('Delivery radius must be between 0.1 and 100 miles.')
      return
    }

    setSaving(true)
    setSaved(false)
    setError('')

    const { error: saveError } = await supabase
      .from('restaurants')
      .update({ delivery_radius_miles: miles, updated_at: new Date().toISOString() })
      .eq('id', restaurant.id)

    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setSaved(true)
  }

  if (loading) return <main className="portal-shell"><div className="menu-state-card">Loading delivery map…</div></main>

  if (!restaurant || !location) {
    return (
      <main className="portal-shell"><div className="menu-state-card"><h1>Restaurant location required</h1><p>Complete onboarding before configuring your delivery map.</p><Link className="primary-button button-link" to="/onboarding">Start setup</Link></div></main>
    )
  }

  return (
    <main className="portal-shell delivery-map-page">
      <header className="portal-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p className="dashboard-kicker">{restaurant.name} · Delivery map</p></div>
        <Link className="secondary-button button-link" to="/delivery-areas">Postcode areas</Link>
      </header>

      <section className="page-heading-row">
        <div><span className="eyebrow">Live coverage</span><h1>Delivery radius map</h1><p>Drag the edge of the circle or enter a radius to control the area your restaurant serves.</p></div>
        <button className="primary-button" type="button" disabled={saving} onClick={() => void saveRadius()}>{saving ? 'Saving…' : 'Save radius'}</button>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <div className="form-success" role="status">Delivery radius saved.</div>}

      <section className="delivery-map-layout">
        <div className="delivery-map-card">
          {mapLoading && <div className="map-loading">Loading Google Maps…</div>}
          <div className="delivery-map-canvas" ref={mapElement} aria-label="Restaurant delivery radius map" />
        </div>

        <aside className="settings-summary-card delivery-map-controls">
          <span className="eyebrow">Coverage controls</span>
          <h2>{restaurant.name}</h2>
          <p>{[location.address_line1, location.city, location.postcode].filter(Boolean).join(', ')}</p>

          <label className="settings-field">
            <span>Delivery radius</span>
            <div className="input-suffix"><input type="number" min="0.1" max="100" step="0.1" value={radius} onChange={(event) => { setRadius(event.target.value); setSaved(false) }} /><span>miles</span></div>
          </label>

          <input className="radius-range" type="range" min="0.5" max="20" step="0.5" value={Math.min(20, Math.max(0.5, Number.parseFloat(radius) || 0.5))} onChange={(event) => { setRadius(event.target.value); setSaved(false) }} />

          <div className="summary-service-list">
            <div><strong>Delivery fee</strong><span>{formatMoney(restaurant.delivery_fee_pence)}</span></div>
            <div><strong>Minimum order</strong><span>{formatMoney(restaurant.minimum_order_pence)}</span></div>
            <div><strong>Coverage diameter</strong><span>{((Number.parseFloat(radius) || 0) * 2).toFixed(1)} miles</span></div>
          </div>

          <Link className="secondary-button button-link full-width-button" to="/settings">Edit delivery pricing</Link>
        </aside>
      </section>
    </main>
  )
}
