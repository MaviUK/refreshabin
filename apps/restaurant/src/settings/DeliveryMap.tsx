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

type ZonePathPoint = { lat: number; lng: number }

type DeliveryZone = {
  id: string
  restaurant_id: string
  name: string
  zone_type: 'delivery' | 'exclusion'
  path: ZonePathPoint[]
  delivery_fee_pence: number | null
  minimum_order_pence: number | null
  estimated_minutes: number | null
  is_active: boolean
  sort_order: number
}

const MILES_TO_METRES = 1609.344
const DELIVERY_ZONE_STYLE = { fillColor: '#22a06b', fillOpacity: 0.2, strokeColor: '#16865a', strokeOpacity: 0.95, strokeWeight: 2 }
const EXCLUSION_ZONE_STYLE = { fillColor: '#dc3545', fillOpacity: 0.22, strokeColor: '#b4232f', strokeOpacity: 0.95, strokeWeight: 2 }

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps?.drawing) return Promise.resolve()
  if (window.__orderedGoogleMapsPromise) return window.__orderedGoogleMapsPromise

  window.__orderedGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry,places,drawing&v=weekly`
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

function poundsToPence(value: string) {
  const pounds = Number.parseFloat(value)
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : null
}

export default function DeliveryMap() {
  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapInstance = useRef<any>(null)
  const circleInstance = useRef<any>(null)
  const drawingManagerInstance = useRef<any>(null)
  const zonePolygons = useRef<Map<string, any>>(new Map())
  const pendingPolygon = useRef<any>(null)

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [location, setLocation] = useState<Location | null>(null)
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [radius, setRadius] = useState('3')
  const [loading, setLoading] = useState(true)
  const [mapLoading, setMapLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [drawingType, setDrawingType] = useState<'delivery' | 'exclusion' | null>(null)
  const [showZoneForm, setShowZoneForm] = useState(false)
  const [zoneName, setZoneName] = useState('')
  const [zoneFee, setZoneFee] = useState('')
  const [zoneMinimum, setZoneMinimum] = useState('')
  const [zoneMinutes, setZoneMinutes] = useState('30')

  useEffect(() => { void loadRestaurant() }, [])
  useEffect(() => {
    if (!restaurant || !location || !mapElement.current) return
    void initialiseMap()
  }, [restaurant, location])
  useEffect(() => {
    const miles = Number.parseFloat(radius)
    if (circleInstance.current && Number.isFinite(miles)) circleInstance.current.setRadius(Math.max(0, miles) * MILES_TO_METRES)
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
      .from('restaurant_members').select('restaurant_id').eq('user_id', userData.user.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()

    if (membershipError || !membership) {
      setError(membershipError?.message || 'Create your restaurant before configuring a delivery map.')
      setLoading(false)
      return
    }

    const [{ data: restaurantData, error: restaurantError }, { data: locationData, error: locationError }, { data: zoneData, error: zoneError }] = await Promise.all([
      supabase.from('restaurants').select('id, name, delivery_radius_miles, delivery_fee_pence, minimum_order_pence').eq('id', membership.restaurant_id).single(),
      supabase.from('restaurant_locations').select('address_line1, address_line2, city, postcode').eq('restaurant_id', membership.restaurant_id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('restaurant_delivery_zones').select('*').eq('restaurant_id', membership.restaurant_id).order('sort_order').order('created_at'),
    ])

    if (restaurantError || locationError || zoneError || !locationData) {
      setError(restaurantError?.message || locationError?.message || zoneError?.message || 'No restaurant address was found.')
      setLoading(false)
      return
    }

    const record = restaurantData as Restaurant
    setRestaurant(record)
    setLocation(locationData as Location)
    setZones((zoneData || []) as DeliveryZone[])
    setRadius(String(record.delivery_radius_miles ?? 3))
    setLoading(false)
  }

  function renderZone(zone: DeliveryZone, map: any) {
    const polygon = new window.google.maps.Polygon({
      map,
      paths: zone.path,
      editable: false,
      clickable: true,
      ...(zone.zone_type === 'exclusion' ? EXCLUSION_ZONE_STYLE : DELIVERY_ZONE_STYLE),
    })
    const info = new window.google.maps.InfoWindow({
      content: `<strong>${zone.name}</strong><br>${zone.zone_type === 'exclusion' ? 'Excluded area' : `${formatMoney(zone.delivery_fee_pence ?? restaurant?.delivery_fee_pence ?? 0)} delivery · ${zone.estimated_minutes ?? 30} mins`}`,
    })
    polygon.addListener('click', (event: any) => info.open({ map, anchor: null, position: event.latLng }))
    zonePolygons.current.set(zone.id, polygon)
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
      const address = [location.address_line1, location.address_line2, location.city, location.postcode, 'United Kingdom'].filter(Boolean).join(', ')
      const result = await new window.google.maps.Geocoder().geocode({ address, region: 'GB' })
      const centre = result.results[0]?.geometry?.location
      if (!centre) throw new Error('Google could not find the restaurant address.')

      const map = new window.google.maps.Map(mapElement.current, { center: centre, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true })
      new window.google.maps.Marker({ map, position: centre, title: restaurant.name })

      const circle = new window.google.maps.Circle({ map, center: centre, radius: (Number.parseFloat(radius) || 0) * MILES_TO_METRES, fillColor: '#ed3978', fillOpacity: 0.1, strokeColor: '#c72f68', strokeOpacity: 0.65, strokeWeight: 2, editable: true })
      circle.addListener('radius_changed', () => { setRadius((circle.getRadius() / MILES_TO_METRES).toFixed(1)); setSaved(false) })

      const drawingManager = new window.google.maps.drawing.DrawingManager({
        drawingControl: false,
        polygonOptions: { editable: true, clickable: false, ...DELIVERY_ZONE_STYLE },
      })
      drawingManager.setMap(map)
      window.google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon: any) => {
        pendingPolygon.current = polygon
        drawingManager.setDrawingMode(null)
        setDrawingType(null)
        setShowZoneForm(true)
      })

      mapInstance.current = map
      circleInstance.current = circle
      drawingManagerInstance.current = drawingManager
      zones.forEach((zone) => renderZone(zone, map))
      if (zones.length === 0) map.fitBounds(circle.getBounds(), 48)
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : 'Unable to initialise Google Maps.')
    } finally {
      setMapLoading(false)
    }
  }

  function beginDrawing(type: 'delivery' | 'exclusion') {
    if (!drawingManagerInstance.current) return
    cancelPendingZone()
    setDrawingType(type)
    drawingManagerInstance.current.setOptions({ polygonOptions: { editable: true, clickable: false, ...(type === 'exclusion' ? EXCLUSION_ZONE_STYLE : DELIVERY_ZONE_STYLE) } })
    drawingManagerInstance.current.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON)
  }

  function cancelPendingZone() {
    pendingPolygon.current?.setMap(null)
    pendingPolygon.current = null
    drawingManagerInstance.current?.setDrawingMode(null)
    setDrawingType(null)
    setShowZoneForm(false)
    setZoneName('')
    setZoneFee('')
    setZoneMinimum('')
    setZoneMinutes('30')
  }

  async function saveZone() {
    if (!restaurant || !pendingPolygon.current || !zoneName.trim()) {
      setError('Give the zone a name before saving it.')
      return
    }
    const path = pendingPolygon.current.getPath().getArray().map((point: any) => ({ lat: point.lat(), lng: point.lng() }))
    if (path.length < 3) {
      setError('A delivery zone needs at least three points.')
      return
    }

    setSaving(true)
    setError('')
    const type = pendingPolygon.current.get('fillColor') === EXCLUSION_ZONE_STYLE.fillColor ? 'exclusion' : 'delivery'
    const payload = {
      restaurant_id: restaurant.id,
      name: zoneName.trim(),
      zone_type: type,
      path,
      delivery_fee_pence: type === 'delivery' ? poundsToPence(zoneFee) : null,
      minimum_order_pence: type === 'delivery' ? poundsToPence(zoneMinimum) : null,
      estimated_minutes: type === 'delivery' ? Number.parseInt(zoneMinutes, 10) || 30 : null,
      sort_order: zones.length,
    }
    const { data, error: saveError } = await supabase.from('restaurant_delivery_zones').insert(payload).select('*').single()
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }

    pendingPolygon.current.setMap(null)
    pendingPolygon.current = null
    const newZone = data as DeliveryZone
    setZones((current) => [...current, newZone])
    if (mapInstance.current) renderZone(newZone, mapInstance.current)
    cancelPendingZone()
  }

  async function deleteZone(zone: DeliveryZone) {
    const { error: deleteError } = await supabase.from('restaurant_delivery_zones').delete().eq('id', zone.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    zonePolygons.current.get(zone.id)?.setMap(null)
    zonePolygons.current.delete(zone.id)
    setZones((current) => current.filter((item) => item.id !== zone.id))
  }

  async function saveRadius() {
    if (!restaurant) return
    const miles = Number.parseFloat(radius)
    if (!Number.isFinite(miles) || miles <= 0 || miles > 100) {
      setError('Delivery radius must be between 0.1 and 100 miles.')
      return
    }
    setSaving(true); setSaved(false); setError('')
    const { error: saveError } = await supabase.from('restaurants').update({ delivery_radius_miles: miles, updated_at: new Date().toISOString() }).eq('id', restaurant.id)
    setSaving(false)
    if (saveError) setError(saveError.message)
    else setSaved(true)
  }

  if (loading) return <main className="portal-shell"><div className="menu-state-card">Loading delivery map…</div></main>
  if (!restaurant || !location) return <main className="portal-shell"><div className="menu-state-card"><h1>Restaurant location required</h1><p>Complete onboarding before configuring your delivery map.</p><Link className="primary-button button-link" to="/onboarding">Start setup</Link></div></main>

  return (
    <main className="portal-shell delivery-map-page">
      <header className="portal-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p className="dashboard-kicker">{restaurant.name} · Delivery map</p></div>
        <Link className="secondary-button button-link" to="/delivery-areas">Postcode areas</Link>
      </header>

      <section className="page-heading-row">
        <div><span className="eyebrow">Live coverage</span><h1>Delivery zones</h1><p>Use the radius as a guide, then draw precise delivery and exclusion areas.</p></div>
        <button className="primary-button" type="button" disabled={saving} onClick={() => void saveRadius()}>{saving ? 'Saving…' : 'Save radius'}</button>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {saved && <div className="form-success" role="status">Delivery radius saved.</div>}

      <div className="zone-toolbar">
        <button className="primary-button" type="button" onClick={() => beginDrawing('delivery')}>+ Draw delivery zone</button>
        <button className="secondary-button" type="button" onClick={() => beginDrawing('exclusion')}>+ Draw exclusion</button>
        {drawingType && <span>Click around the map, then click the first point to finish.</span>}
      </div>

      <section className="delivery-map-layout">
        <div className="delivery-map-card">
          {mapLoading && <div className="map-loading">Loading Google Maps…</div>}
          <div className="delivery-map-canvas" ref={mapElement} aria-label="Restaurant delivery zone editor" />
        </div>

        <aside className="settings-summary-card delivery-map-controls">
          <span className="eyebrow">Coverage controls</span>
          <h2>{restaurant.name}</h2>
          <p>{[location.address_line1, location.city, location.postcode].filter(Boolean).join(', ')}</p>
          <label className="settings-field"><span>Guide radius</span><div className="input-suffix"><input type="number" min="0.1" max="100" step="0.1" value={radius} onChange={(event) => { setRadius(event.target.value); setSaved(false) }} /><span>miles</span></div></label>
          <input className="radius-range" type="range" min="0.5" max="20" step="0.5" value={Math.min(20, Math.max(0.5, Number.parseFloat(radius) || 0.5))} onChange={(event) => { setRadius(event.target.value); setSaved(false) }} />
          <div className="summary-service-list"><div><strong>Default fee</strong><span>{formatMoney(restaurant.delivery_fee_pence)}</span></div><div><strong>Default minimum</strong><span>{formatMoney(restaurant.minimum_order_pence)}</span></div><div><strong>Saved zones</strong><span>{zones.length}</span></div></div>
          <Link className="secondary-button button-link full-width-button" to="/settings">Edit default pricing</Link>
        </aside>
      </section>

      {showZoneForm && (
        <section className="settings-panel zone-form-panel">
          <div><span className="eyebrow">New map area</span><h2>Save this zone</h2></div>
          <div className="form-grid">
            <label className="large-field full-width">Zone name<input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="e.g. Bangor Centre" autoFocus /></label>
            <label className="large-field">Delivery fee (£)<input type="number" min="0" step="0.01" value={zoneFee} onChange={(event) => setZoneFee(event.target.value)} placeholder={(restaurant.delivery_fee_pence / 100).toFixed(2)} /></label>
            <label className="large-field">Minimum order (£)<input type="number" min="0" step="0.01" value={zoneMinimum} onChange={(event) => setZoneMinimum(event.target.value)} placeholder={(restaurant.minimum_order_pence / 100).toFixed(2)} /></label>
            <label className="large-field">Estimated delivery time<input type="number" min="1" max="480" value={zoneMinutes} onChange={(event) => setZoneMinutes(event.target.value)} /></label>
          </div>
          <div className="onboarding-actions"><button className="text-button" type="button" onClick={cancelPendingZone}>Cancel</button><button className="primary-button" type="button" disabled={saving} onClick={() => void saveZone()}>{saving ? 'Saving…' : 'Save zone'}</button></div>
        </section>
      )}

      <section className="settings-panel">
        <div><span className="eyebrow">Saved coverage</span><h2>Delivery and exclusion zones</h2></div>
        {zones.length === 0 ? <p>No custom zones yet. Draw one on the map to begin.</p> : (
          <div className="delivery-zone-list">{zones.map((zone) => <article className="delivery-zone-row" key={zone.id}><div><strong>{zone.name}</strong><span>{zone.zone_type === 'exclusion' ? 'Excluded area' : `${formatMoney(zone.delivery_fee_pence ?? restaurant.delivery_fee_pence)} · ${zone.estimated_minutes ?? 30} mins`}</span></div><button className="danger-text-button" type="button" onClick={() => void deleteZone(zone)}>Delete</button></article>)}</div>
        )}
      </section>
    </main>
  )
}
