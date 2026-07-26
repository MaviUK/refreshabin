import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Restaurants.css'

type Restaurant = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  cover_url: string | null
  cuisines: string[] | null
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number
  delivery_fee_pence: number
  preparation_time_minutes: number
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export default function Restaurants() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const selectedCuisine = searchParams.get('cuisine') ?? ''
  const postcode = searchParams.get('postcode') ?? ''

  useEffect(() => {
    async function loadRestaurants() {
      setLoading(true)
      setError('')

      const { data, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id, name, slug, logo_url, cover_url, cuisines, accepts_delivery, accepts_collection, minimum_order_pence, delivery_fee_pence, preparation_time_minutes')
        .eq('status', 'approved')
        .order('name')

      if (restaurantError) {
        setError(restaurantError.message)
      } else {
        setRestaurants((data ?? []) as Restaurant[])
      }
      setLoading(false)
    }

    loadRestaurants()
  }, [])

  const cuisineOptions = useMemo(() => {
    const values = restaurants.flatMap((restaurant) => restaurant.cuisines ?? [])
    return Array.from(new Set(values)).sort()
  }, [restaurants])

  const visibleRestaurants = useMemo(() => restaurants.filter((restaurant) => {
    const matchesSearch = restaurant.name.toLowerCase().includes(search.trim().toLowerCase())
    const matchesCuisine = !selectedCuisine || (restaurant.cuisines ?? []).some((cuisine) => cuisine.toLowerCase() === selectedCuisine.toLowerCase())
    return matchesSearch && matchesCuisine
  }), [restaurants, search, selectedCuisine])

  function chooseCuisine(cuisine: string) {
    const next = new URLSearchParams(searchParams)
    if (cuisine) next.set('cuisine', cuisine)
    else next.delete('cuisine')
    setSearchParams(next)
  }

  return (
    <main className="restaurants-page">
      <header className="restaurants-header">
        <Link className="restaurants-logo" to="/">ordered.food</Link>
        <nav><Link to="/login">Restaurant login</Link><Link to="/register">List your business</Link></nav>
      </header>

      <section className="restaurants-intro">
        <span>Food near you</span>
        <h1>{postcode ? `Restaurants near ${postcode}` : 'Find your next favourite'}</h1>
        <p>Browse local restaurants available for delivery and collection.</p>

        <div className="restaurant-search-row">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search restaurants" aria-label="Search restaurants" />
          <select value={selectedCuisine} onChange={(event) => chooseCuisine(event.target.value)} aria-label="Filter by cuisine">
            <option value="">All cuisines</option>
            {cuisineOptions.map((cuisine) => <option key={cuisine} value={cuisine}>{cuisine}</option>)}
          </select>
        </div>
      </section>

      {error && <p className="restaurants-error">{error}</p>}

      {loading ? (
        <section className="restaurants-state">Finding restaurants…</section>
      ) : visibleRestaurants.length ? (
        <section className="restaurant-grid">
          {visibleRestaurants.map((restaurant) => (
            <Link className="restaurant-card" to={`/r/${restaurant.slug}`} key={restaurant.id}>
              <div className="restaurant-cover" style={restaurant.cover_url ? { backgroundImage: `url(${restaurant.cover_url})` } : undefined}>
                {!restaurant.cover_url && <span>{restaurant.name.charAt(0)}</span>}
                {restaurant.logo_url && <img src={restaurant.logo_url} alt="" />}
              </div>
              <div className="restaurant-card-body">
                <div>
                  <h2>{restaurant.name}</h2>
                  <p>{(restaurant.cuisines ?? []).join(' · ') || 'Local restaurant'}</p>
                </div>
                <div className="restaurant-meta">
                  <span>{restaurant.preparation_time_minutes || 30}–{(restaurant.preparation_time_minutes || 30) + 10} min</span>
                  {restaurant.accepts_delivery && <span>{restaurant.delivery_fee_pence > 0 ? `${money.format(restaurant.delivery_fee_pence / 100)} delivery` : 'Free delivery'}</span>}
                  {restaurant.minimum_order_pence > 0 && <span>{money.format(restaurant.minimum_order_pence / 100)} minimum</span>}
                </div>
                <div className="fulfilment-tags">
                  {restaurant.accepts_delivery && <span>Delivery</span>}
                  {restaurant.accepts_collection && <span>Collection</span>}
                </div>
              </div>
            </Link>
          ))}
        </section>
      ) : (
        <section className="restaurants-empty">
          <span>🍽️</span>
          <h2>No restaurants found</h2>
          <p>Try another search or cuisine. More local restaurants will appear here as they join ordered.food.</p>
          <button onClick={() => { setSearch(''); chooseCuisine('') }}>Clear filters</button>
        </section>
      )}
    </main>
  )
}
