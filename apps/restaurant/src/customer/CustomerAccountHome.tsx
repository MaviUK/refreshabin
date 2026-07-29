import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccountHome.css'

type AccountSummary = {
  firstName: string
  email: string
  orderCount: number
  addressCount: number
  favouriteCount: number
  latestOrder: {
    order_number: number
    restaurant_name: string
    restaurant_slug: string
    order_status: string
    total_pence: number
    created_at: string
  } | null
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

function formatStatus(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function CustomerAccountHome() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<AccountSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    async function loadAccount() {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        navigate('/account/login', { replace: true, state: { from: '/account' } })
        return
      }

      const [profileResult, ordersResult, addressesResult, restaurantFavouritesResult, itemFavouritesResult] = await Promise.all([
        supabase.from('customer_profiles').select('first_name').eq('user_id', user.id).maybeSingle(),
        supabase.from('orders').select('order_number,restaurant_name,restaurant_slug,order_status,total_pence,created_at', { count: 'exact' }).eq('customer_user_id', user.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('customer_addresses').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('customer_favourite_restaurants').select('restaurant_id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('customer_favourite_items').select('menu_item_id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      const firstError = profileResult.error || ordersResult.error || addressesResult.error || restaurantFavouritesResult.error || itemFavouritesResult.error
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      setSummary({
        firstName: profileResult.data?.first_name || '',
        email: user.email || '',
        orderCount: ordersResult.count || 0,
        addressCount: addressesResult.count || 0,
        favouriteCount: (restaurantFavouritesResult.count || 0) + (itemFavouritesResult.count || 0),
        latestOrder: ordersResult.data?.[0] || null,
      })
      setLoading(false)
    }

    void loadAccount()
  }, [navigate])

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    navigate('/restaurants', { replace: true })
  }

  if (loading) return <main className="customer-home-state">Loading your account…</main>
  if (error || !summary) return <main className="customer-home-state"><h1>Unable to load your account</h1><p>{error}</p></main>

  return (
    <main className="customer-home-page">
      <header className="customer-home-header">
        <Link className="customer-home-brand" to="/restaurants">ordered.food</Link>
        <button type="button" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </header>

      <section className="customer-home-hero">
        <span>Your account</span>
        <h1>{summary.firstName ? `Hi, ${summary.firstName}` : 'Welcome back'}</h1>
        <p>{summary.email}</p>
      </section>

      <section className="customer-home-grid" aria-label="Account sections">
        <Link to="/account/orders"><span className="customer-home-icon">↻</span><div><strong>Orders</strong><small>{summary.orderCount} order{summary.orderCount === 1 ? '' : 's'}</small></div><span>›</span></Link>
        <Link to="/account/favourites"><span className="customer-home-icon">♥</span><div><strong>Favourites</strong><small>{summary.favouriteCount} saved</small></div><span>›</span></Link>
        <Link to="/account/addresses"><span className="customer-home-icon">⌂</span><div><strong>Addresses</strong><small>{summary.addressCount} saved</small></div><span>›</span></Link>
        <Link to="/account/profile"><span className="customer-home-icon">◉</span><div><strong>Your details</strong><small>Name and mobile number</small></div><span>›</span></Link>
        <Link to="/restaurants"><span className="customer-home-icon">＋</span><div><strong>Find food</strong><small>Browse restaurants</small></div><span>›</span></Link>
      </section>

      <section className="customer-home-latest">
        <div className="customer-home-section-heading"><div><span>Most recent</span><h2>Latest order</h2></div><Link to="/account/orders">View all</Link></div>
        {summary.latestOrder ? (
          <article>
            <div><span>Order #{summary.latestOrder.order_number}</span><h3>{summary.latestOrder.restaurant_name}</h3><small>{date.format(new Date(summary.latestOrder.created_at))}</small></div>
            <div className="customer-home-order-meta"><strong>{money.format(summary.latestOrder.total_pence / 100)}</strong><span>{formatStatus(summary.latestOrder.order_status)}</span></div>
            <Link to={`/r/${summary.latestOrder.restaurant_slug}`}>Order again</Link>
          </article>
        ) : (
          <div className="customer-home-empty"><p>You have not placed an order yet.</p><Link to="/restaurants">Browse restaurants</Link></div>
        )}
      </section>
    </main>
  )
}
