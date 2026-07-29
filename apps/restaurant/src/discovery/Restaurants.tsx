import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
  const navigate = useNavigate()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [favourites, setFavourites] = useState<Set<string>>(new Set())
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [savingFavourite, setSavingFavourite] = useState<string | null>(null)

  const selectedCuisine = searchParams.get('cuisine') ?? ''
  const postcode = searchParams.get('postcode') ?? ''

  useEffect(() => {
    async function loadRestaurants() {
      setLoading(true)
      setError('')

      const [{ data, error: restaurantError }, { data: sessionData }] = await Promise.all([
        supabase
          .from('restaurants')
          .select('id, name, slug, logo_url, cover_url, cuisines, accepts_delivery, accepts_collection, minimum_order_pence, delivery_fee_pence, preparation_time_minutes')
          .eq('status', 'active')
          .order('name'),
        supabase.auth.getSession(),
      ])

      if (restaurantError) setError(restaurantError.message)
      else setRestaurants((data ?? []) as Restaurant[])

      const user = sessionData.session?.user
      setSignedIn(Boolean(user))
      if (user) {
        const { data: favouriteRows } = await supabase
          .from('customer_favourite_restaurants')
          .select('restaurant_id')
          .eq('user_id', user.id)
        setFavourites(new Set((favouriteRows ?? []).map((row) => row.restaurant_id as string)))
      }
      setLoading(false)
    }

    void loadRestaurants()
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)))
    return () => authListener.subscription.unsubscribe()
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

  async function toggleFavourite(restaurantId: string) {
    if (!signedIn) {
      navigate('/account/login', { state: { from: `${window.location.pathname}${window.location.search}` } })
      return
    }
    if (savingFavourite) return

    setSavingFavourite(restaurantId)
    const isFavourite = favourites.has(restaurantId)
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) {
      setSavingFavourite(null)
      navigate('/account/login', { state: { from: `${window.location.pathname}${window.location.search}` } })
      return
    }

    const result = isFavourite
      ? await supabase.from('customer_favourite_restaurants').delete().eq('user_id', user.id).eq('restaurant_id', restaurantId)
      : await supabase.from('customer_favourite_restaurants').insert({ user_id: user.id, restaurant_id: restaurantId })

    if (result.error) setError(result.error.message)
    else {
      setFavourites((current) => {
        const next = new Set(current)
        if (isFavourite) next.delete(restaurantId)
        else next.add(restaurantId)
        return next
      })
    }
    setSavingFavourite(null)
  }

  return (
    <main className="restaurants-page">
      <header className="restaurants-header">
        <Link className="restaurants-logo" to="/">ordered.food</Link>
        <nav>
          {signedIn ? <><Link to="/account">My account</Link><Link to="/account/favourites">Favourites</Link><Link to="/account/orders">Orders</Link></> : <Link to="/account/login" state={{ from: `${window.location.pathname}${window.location.search}` }}>Customer login</Link>}
          <Link to="/login">Restaurant login</Link>
        </nav>
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
          {visibleRestaurants.map((restaurant) => {
            const isFavourite = favourites.has(restaurant.id)
            return (
              <article className="restaurant-card" key={restaurant.id}>
                <Link className="restaurant-card-link" to={`/r/${restaurant.slug}`}>
                  <div className="restaurant-cover" style={restaurant.cover_url ? { backgroundImage: `url(${restaurant.cover_url})` } : undefined}>
                    {!restaurant.cover_url && <span>{restaurant.name.charAt(0)}</span>}
                    {restaurant.logo_url && <img src={restaurant.logo_url} alt="" />}
                  </div>
                  <div className="restaurant-card-body">
                    <div><h2>{restaurant.name}</h2><p>{(restaurant.cuisines ?? []).join(' · ') || 'Local restaurant'}</p></div>
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
                <button
                  className={isFavourite ? 'restaurant-favourite selected' : 'restaurant-favourite'}
                  type="button"
                  aria-label={isFavourite ? `Remove ${restaurant.name} from favourites` : `Add ${restaurant.name} to favourites`}
                  aria-pressed={isFavourite}
                  disabled={savingFavourite === restaurant.id}
                  onClick={() => void toggleFavourite(restaurant.id)}
                >{isFavourite ? '♥' : '♡'}</button>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="restaurants-empty">
          <span>🍽️</span><h2>No restaurants found</h2>
          <p>Try another search or cuisine. More local restaurants will appear here as they join ordered.food.</p>
          <button onClick={() => { setSearch(''); chooseCuisine('') }}>Clear filters</button>
        </section>
      )}
    </main>
  )
}
