import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { foodCategories } from '../lib/foodCategories'
import { supabase } from '../lib/supabase'
import { usePlatformConfiguration } from '../lib/platformConfiguration'
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

function OrderedLogo() {
  return <span className="discovery-logo" aria-label="ordered.food"><span>ordered</span><small><b>.</b>food</small></span>
}

export default function Restaurants() {
  const { configuration } = usePlatformConfiguration()
  const favouritesEnabled = configuration.feature_flags.customer_favourites
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [favourites, setFavourites] = useState<Set<string>>(new Set())
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [savingFavourite, setSavingFavourite] = useState<string | null>(null)

  const selectedCuisine = searchParams.get('cuisine') ?? ''
  const postcode = searchParams.get('postcode') ?? ''
  const searchFromUrl = searchParams.get('search') ?? ''

  useEffect(() => { setSearch(searchFromUrl) }, [searchFromUrl])

  useEffect(() => {
    async function loadRestaurants() {
      setLoading(true)
      setError('')
      const [{ data, error: restaurantError }, { data: sessionData }] = await Promise.all([
        supabase.from('restaurants').select('id, name, slug, logo_url, cover_url, cuisines, accepts_delivery, accepts_collection, minimum_order_pence, delivery_fee_pence, preparation_time_minutes').eq('status', 'active').order('name'),
        supabase.auth.getSession(),
      ])
      if (restaurantError) setError(restaurantError.message)
      else setRestaurants((data ?? []) as Restaurant[])
      const user = sessionData.session?.user
      setSignedIn(Boolean(user))
      if (user && favouritesEnabled) {
        const { data: favouriteRows } = await supabase.from('customer_favourite_restaurants').select('restaurant_id').eq('user_id', user.id)
        setFavourites(new Set((favouriteRows ?? []).map((row) => row.restaurant_id as string)))
      }
      setLoading(false)
    }
    void loadRestaurants()
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)))
    return () => authListener.subscription.unsubscribe()
  }, [favouritesEnabled])

  const cuisineOptions = useMemo(() => {
    const assignedCategories = restaurants.flatMap((restaurant) => restaurant.cuisines ?? [])
    return Array.from(new Set([...foodCategories, ...assignedCategories])).sort((a, b) => a.localeCompare(b))
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
    if (!favouritesEnabled) return
    if (!signedIn) { navigate('/account/login', { state: { from: `${window.location.pathname}${window.location.search}` } }); return }
    if (savingFavourite) return
    setSavingFavourite(restaurantId)
    const isFavourite = favourites.has(restaurantId)
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) { setSavingFavourite(null); navigate('/account/login', { state: { from: `${window.location.pathname}${window.location.search}` } }); return }
    const result = isFavourite
      ? await supabase.from('customer_favourite_restaurants').delete().eq('user_id', user.id).eq('restaurant_id', restaurantId)
      : await supabase.from('customer_favourite_restaurants').insert({ user_id: user.id, restaurant_id: restaurantId })
    if (result.error) setError(result.error.message)
    else setFavourites((current) => { const next = new Set(current); if (isFavourite) next.delete(restaurantId); else next.add(restaurantId); return next })
    setSavingFavourite(null)
  }

  return (
    <main className="restaurants-page">
      <header className="restaurants-header-shell">
        <div className="restaurants-header">
          <Link className="restaurants-logo-link" to="/" aria-label="ordered.food home"><OrderedLogo /></Link>
          <nav aria-label="Customer navigation">
            <Link to="/restaurants" className="active">Browse food</Link>
            {signedIn ? <Link className="account-pill" to="/account">My account</Link> : <Link className="account-pill" to="/account/login" state={{ from: `${window.location.pathname}${window.location.search}` }}>Log in</Link>}
          </nav>
        </div>
      </header>

      <section className="restaurants-intro">
        <span>Food near you</span>
        <h1>{postcode ? `Restaurants near ${postcode}` : search ? `Results for “${search}”` : 'Find your next favourite'}</h1>
        <p>{visibleRestaurants.length && !loading ? `${visibleRestaurants.length} place${visibleRestaurants.length === 1 ? '' : 's'} to choose from` : 'Local restaurants available for delivery and collection.'}</p>

        <div className="restaurant-search-row">
          <div className="restaurant-search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search restaurants" aria-label="Search restaurants" /></div>
          <select value={selectedCuisine} onChange={(event) => chooseCuisine(event.target.value)} aria-label="Filter by cuisine">
            <option value="">All food</option>
            {cuisineOptions.map((cuisine) => <option key={cuisine} value={cuisine}>{cuisine}</option>)}
          </select>
        </div>
      </section>

      {error && <p className="restaurants-error">{error}</p>}

      {loading ? <section className="restaurants-state">Finding restaurants…</section> : visibleRestaurants.length ? (
        <section className="restaurant-grid">
          {visibleRestaurants.map((restaurant) => {
            const isFavourite = favourites.has(restaurant.id)
            const primaryCuisine = restaurant.cuisines?.[0]
            return (
              <article className="restaurant-card" key={restaurant.id}>
                <Link className="restaurant-card-link" to={`/r/${restaurant.slug}`}>
                  <div className="restaurant-cover" style={restaurant.cover_url ? { backgroundImage: `url(${restaurant.cover_url})` } : undefined}>
                    {!restaurant.cover_url && <span>{restaurant.name.charAt(0)}</span>}
                    {restaurant.logo_url && <img src={restaurant.logo_url} alt="" />}
                  </div>
                  <div className="restaurant-card-body">
                    <div className="restaurant-title-row"><div><h2>{restaurant.name}</h2><p>{primaryCuisine || 'Local restaurant'}</p></div></div>
                    <div className="restaurant-meta">
                      <span>{restaurant.preparation_time_minutes || 30}–{(restaurant.preparation_time_minutes || 30) + 10} min</span>
                      {restaurant.accepts_delivery && <span>{restaurant.delivery_fee_pence > 0 ? `${money.format(restaurant.delivery_fee_pence / 100)} delivery` : 'Free delivery'}</span>}
                      {restaurant.minimum_order_pence > 0 && <span>{money.format(restaurant.minimum_order_pence / 100)} min.</span>}
                    </div>
                    <div className="fulfilment-tags">{restaurant.accepts_delivery && <span>Delivery</span>}{restaurant.accepts_collection && <span>Collection</span>}</div>
                  </div>
                </Link>
                {favouritesEnabled && <button className={isFavourite ? 'restaurant-favourite selected' : 'restaurant-favourite'} type="button" aria-label={isFavourite ? `Remove ${restaurant.name} from favourites` : `Add ${restaurant.name} to favourites`} aria-pressed={isFavourite} disabled={savingFavourite === restaurant.id} onClick={() => void toggleFavourite(restaurant.id)}>{isFavourite ? '♥' : '♡'}</button>}
              </article>
            )
          })}
        </section>
      ) : <section className="restaurants-empty"><span>🍽️</span><h2>No restaurants found</h2><p>Try another restaurant name or food category.</p><button onClick={() => { setSearch(''); chooseCuisine('') }}>Clear filters</button></section>}
    </main>
  )
}
