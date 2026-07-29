import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerFavourites.css'

type FavouriteRestaurant = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  cover_url: string | null
  cuisines: string[] | null
  accepts_delivery: boolean
  accepts_collection: boolean
  delivery_fee_pence: number
  minimum_order_pence: number
  preparation_time_minutes: number
}

type FavouriteItem = {
  id: string
  name: string
  description: string | null
  price_pence: number
  image_url: string | null
  restaurant_name: string
  restaurant_slug: string
}

type FavouritesResponse = {
  restaurants: FavouriteRestaurant[]
  items: FavouriteItem[]
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export default function CustomerFavourites() {
  const navigate = useNavigate()
  const [restaurants, setRestaurants] = useState<FavouriteRestaurant[]>([])
  const [items, setItems] = useState<FavouriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    async function loadFavourites() {
      setLoading(true)
      setError('')
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session?.user) {
        navigate('/account/login', { replace: true })
        return
      }

      const { data, error: favouritesError } = await supabase.rpc('get_customer_favourites')
      if (favouritesError) setError(favouritesError.message)
      else {
        const favourites = data as FavouritesResponse | null
        setRestaurants(favourites?.restaurants ?? [])
        setItems(favourites?.items ?? [])
      }
      setLoading(false)
    }

    void loadFavourites()
  }, [navigate])

  async function removeRestaurant(restaurantId: string) {
    if (removing) return
    setRemoving(`restaurant:${restaurantId}`)
    const { data } = await supabase.auth.getUser()
    if (!data.user) return
    const { error: deleteError } = await supabase
      .from('customer_favourite_restaurants')
      .delete()
      .eq('user_id', data.user.id)
      .eq('restaurant_id', restaurantId)
    if (deleteError) setError(deleteError.message)
    else setRestaurants((current) => current.filter((restaurant) => restaurant.id !== restaurantId))
    setRemoving(null)
  }

  async function removeItem(itemId: string) {
    if (removing) return
    setRemoving(`item:${itemId}`)
    const { data } = await supabase.auth.getUser()
    if (!data.user) return
    const { error: deleteError } = await supabase
      .from('customer_favourite_items')
      .delete()
      .eq('user_id', data.user.id)
      .eq('menu_item_id', itemId)
    if (deleteError) setError(deleteError.message)
    else setItems((current) => current.filter((item) => item.id !== itemId))
    setRemoving(null)
  }

  return (
    <main className="customer-favourites-page">
      <header className="customer-favourites-header">
        <Link to="/restaurants">← Restaurants</Link>
        <strong>ordered.food</strong>
        <nav><Link to="/account/orders">Orders</Link><Link to="/account/addresses">Addresses</Link></nav>
      </header>

      <section className="customer-favourites-shell">
        <div className="customer-favourites-title">
          <span>Your account</span>
          <h1>Favourites</h1>
          <p>Keep your regular restaurants and dishes close at hand.</p>
        </div>

        {error && <p className="customer-favourites-error">{error}</p>}
        {loading ? <div className="customer-favourites-state">Loading your favourites…</div> : (
          <>
            <section className="customer-favourites-section">
              <div className="customer-favourites-section-heading">
                <div><h2>Favourite restaurants</h2><p>{restaurants.length} saved</p></div>
                <Link to="/restaurants">Browse restaurants</Link>
              </div>
              {restaurants.length ? (
                <div className="customer-favourite-restaurant-grid">
                  {restaurants.map((restaurant) => (
                    <article className="customer-favourite-restaurant" key={restaurant.id}>
                      <Link to={`/r/${restaurant.slug}`}>
                        <div className="customer-favourite-cover" style={restaurant.cover_url ? { backgroundImage: `url(${restaurant.cover_url})` } : undefined}>
                          {!restaurant.cover_url && <span>{restaurant.name.charAt(0)}</span>}
                          {restaurant.logo_url && <img src={restaurant.logo_url} alt="" />}
                        </div>
                        <div className="customer-favourite-copy">
                          <h3>{restaurant.name}</h3>
                          <p>{restaurant.cuisines?.join(' · ') || 'Local restaurant'}</p>
                          <div>
                            <span>{restaurant.preparation_time_minutes || 30} min</span>
                            {restaurant.accepts_delivery && <span>{restaurant.delivery_fee_pence ? `${money.format(restaurant.delivery_fee_pence / 100)} delivery` : 'Free delivery'}</span>}
                          </div>
                        </div>
                      </Link>
                      <button type="button" onClick={() => void removeRestaurant(restaurant.id)} disabled={removing === `restaurant:${restaurant.id}`}>Remove</button>
                    </article>
                  ))}
                </div>
              ) : <div className="customer-favourites-empty"><span>♡</span><h3>No favourite restaurants yet</h3><p>Tap the heart on any restaurant to save it here.</p><Link to="/restaurants">Find restaurants</Link></div>}
            </section>

            <section className="customer-favourites-section">
              <div className="customer-favourites-section-heading"><div><h2>Favourite dishes</h2><p>{items.length} saved</p></div></div>
              {items.length ? (
                <div className="customer-favourite-item-list">
                  {items.map((item) => (
                    <article className="customer-favourite-item" key={item.id}>
                      <Link to={`/r/${item.restaurant_slug}`}>
                        {item.image_url ? <img src={item.image_url} alt={item.name} /> : <div className="customer-favourite-item-placeholder">{item.name.charAt(0)}</div>}
                        <div><span>{item.restaurant_name}</span><h3>{item.name}</h3>{item.description && <p>{item.description}</p>}<strong>{money.format(item.price_pence / 100)}</strong></div>
                      </Link>
                      <button type="button" onClick={() => void removeItem(item.id)} disabled={removing === `item:${item.id}`}>Remove</button>
                    </article>
                  ))}
                </div>
              ) : <div className="customer-favourites-empty"><span>♡</span><h3>No favourite dishes yet</h3><p>Favourite menu items will appear here for quicker ordering.</p></div>}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
