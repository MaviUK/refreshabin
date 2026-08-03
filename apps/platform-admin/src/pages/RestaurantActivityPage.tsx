import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAdmin } from '../components/AdminLayout'
import RestaurantActivity from '../components/RestaurantActivity'
import { supabase } from '../lib/supabase'
import { hasAdminPermission, statusLabels, type Restaurant } from '../types'

export default function RestaurantActivityPage() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'restaurants:manage')
  const [params, setParams] = useSearchParams()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(params.get('restaurant'))
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_restaurants', {
      p_status: null,
      p_search: search.trim() || null,
    })
    if (loadError) {
      setError(loadError.message)
      setRestaurants([])
    } else {
      const rows = Array.isArray(data) ? data as Restaurant[] : []
      setRestaurants(rows)
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null)
    }
    setLoading(false)
  }, [search])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  const selected = useMemo(() => restaurants.find((restaurant) => restaurant.id === selectedId) ?? null, [restaurants, selectedId])

  function selectRestaurant(id: string) {
    setSelectedId(id)
    const next = new URLSearchParams(params)
    next.set('restaurant', id)
    setParams(next, { replace: true })
  }

  return (
    <div className="admin-page restaurants-page">
      <header className="page-heading">
        <div><span className="admin-kicker">Restaurant operations</span><h1>Restaurant activity</h1><p>Keep private operational notes and review every platform-admin action taken on a restaurant.</p></div>
      </header>

      <div className="restaurant-toolbar">
        <label className="admin-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search restaurant name, email or URL…" /></label>
      </div>

      {error && <div className="admin-alert error" role="alert">{error}</div>}

      <div className="restaurant-workspace">
        <section className="restaurant-list" aria-label="Restaurants">
          <div className="list-heading"><strong>{loading ? 'Loading…' : `${restaurants.length} restaurant${restaurants.length === 1 ? '' : 's'}`}</strong><small>All statuses</small></div>
          {!loading && !restaurants.length && <div className="panel-empty"><strong>No restaurants found</strong><span>Try a different search.</span></div>}
          {restaurants.map((restaurant) => (
            <button type="button" className={`restaurant-list-row ${restaurant.id === selectedId ? 'active' : ''}`} onClick={() => selectRestaurant(restaurant.id)} key={restaurant.id}>
              <span className="restaurant-logo">{restaurant.logo_url ? <img src={restaurant.logo_url} alt="" /> : restaurant.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{restaurant.name}</strong><small>{restaurant.location?.city || restaurant.location?.postcode || restaurant.email || 'Location not supplied'}</small></span>
              <span className={`status-badge ${restaurant.status}`}>{statusLabels[restaurant.status]}</span>
            </button>
          ))}
        </section>

        <section className="restaurant-detail">
          {!selected && <div className="panel-empty"><strong>Select a restaurant</strong><span>Its internal notes and activity history will appear here.</span></div>}
          {selected && <>
            <div className="restaurant-detail-header">
              <div className="restaurant-identity"><span className="restaurant-logo large">{selected.logo_url ? <img src={selected.logo_url} alt="" /> : selected.name.slice(0, 1).toUpperCase()}</span><div><span className={`status-badge ${selected.status}`}>{statusLabels[selected.status]}</span><h2>{selected.name}</h2><p>Private platform record · /{selected.slug}</p></div></div>
              <a className="secondary-button" href={`/restaurants?restaurant=${selected.id}`}>Open restaurant controls</a>
            </div>
            {!canManage && <div className="read-only-notice"><strong>Read-only access</strong><span>Your role can review notes and activity but cannot add notes.</span></div>}
            <RestaurantActivity restaurantId={selected.id} canManage={canManage} />
          </>}
        </section>
      </div>
    </div>
  )
}
