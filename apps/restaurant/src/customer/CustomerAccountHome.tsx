import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccountHome.css'

type ReorderItem = {
  id: string
  line_id: string
  name: string
  price_pence: number
  unit_price_pence: number
  quantity: number
  removed_ingredients?: Array<{ id: string; name: string }>
  selected_extras?: Array<{ id: string; name: string; price_pence: number; quantity: number }>
  selected_modifier_groups?: Array<{
    group_id: string
    group_name: string
    options: Array<{ id: string; name: string; price_pence: number; quantity: number }>
  }>
  special_instructions?: string | null
}

type ReorderResponse = {
  restaurant_slug: string
  items: ReorderItem[]
  unavailable_items: Array<{ name: string; quantity: number }>
  price_changed_items: Array<{ name: string; old_price_pence: number; new_price_pence: number }>
}

type CustomerOrderSummary = {
  id: string
  order_number: number
  restaurant_name: string
  restaurant_slug: string
  order_status: string
  total_pence: number
  created_at: string
}

type AccountSummary = {
  firstName: string
  email: string
  orderCount: number
  addressCount: number
  favouriteCount: number
  latestOrder: CustomerOrderSummary | null
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
  const [reordering, setReordering] = useState(false)

  useEffect(() => {
    let active = true

    async function loadAccount() {
      setLoading(true)
      setError('')

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (sessionError || !user) {
        navigate('/account/login', { replace: true, state: { from: '/account' } })
        return
      }

      await supabase.rpc('claim_customer_orders')

      const [profileResult, ordersResult, addressesResult, restaurantFavouritesResult, itemFavouritesResult] = await Promise.all([
        supabase.from('customer_profiles').select('first_name').eq('user_id', user.id).maybeSingle(),
        supabase.rpc('get_customer_order_history'),
        supabase.from('customer_addresses').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('customer_favourite_restaurants').select('restaurant_id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('customer_favourite_items').select('menu_item_id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      if (!active) return

      const accountOrders = ((ordersResult.data || []) as CustomerOrderSummary[])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      const nonFatalErrors = [
        profileResult.error,
        ordersResult.error,
        addressesResult.error,
        restaurantFavouritesResult.error,
        itemFavouritesResult.error,
      ].filter(Boolean)

      setSummary({
        firstName: profileResult.data?.first_name || '',
        email: user.email || '',
        orderCount: ordersResult.error ? 0 : accountOrders.length,
        addressCount: addressesResult.error ? 0 : addressesResult.count || 0,
        favouriteCount: (restaurantFavouritesResult.error ? 0 : restaurantFavouritesResult.count || 0)
          + (itemFavouritesResult.error ? 0 : itemFavouritesResult.count || 0),
        latestOrder: ordersResult.error ? null : accountOrders[0] || null,
      })

      if (nonFatalErrors.length) {
        setError('Some account information could not be loaded. Your account links will still work.')
      }
      setLoading(false)
    }

    void loadAccount()
    return () => {
      active = false
    }
  }, [navigate])

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    navigate('/restaurants', { replace: true })
  }

  async function reorderLatest() {
    if (!summary?.latestOrder || reordering) return
    setReordering(true)
    setError('')

    const { data, error: reorderError } = await supabase.rpc('get_customer_reorder_basket', { target_order_id: summary.latestOrder.id })
    if (reorderError) {
      setError(reorderError.message)
      setReordering(false)
      return
    }

    const result = data as ReorderResponse
    if (!result.items.length) {
      setError('None of the items from your latest order are currently available.')
      setReordering(false)
      return
    }

    const warnings: string[] = []
    if (result.unavailable_items.length) warnings.push(`${result.unavailable_items.length} unavailable item${result.unavailable_items.length === 1 ? '' : 's'} will be left out.`)
    if (result.price_changed_items.length) warnings.push(`${result.price_changed_items.length} item${result.price_changed_items.length === 1 ? ' has' : 's have'} changed price.`)
    if (warnings.length && !window.confirm(`${warnings.join('\n')}\n\nContinue with the available items?`)) {
      setReordering(false)
      return
    }

    const basket = Object.fromEntries(result.items.map((item) => [item.line_id, item]))
    window.localStorage.setItem(`ordered-food-basket:${result.restaurant_slug}`, JSON.stringify(basket))
    navigate(`/r/${result.restaurant_slug}`)
  }

  if (loading) return <main className="customer-home-state">Loading your account…</main>
  if (!summary) return <main className="customer-home-state"><h1>Unable to load your account</h1><p>{error || 'Please sign in again and retry.'}</p><Link to="/account/login">Sign in</Link></main>

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

      {error && <div className="customer-home-error" role="alert">{error}</div>}

      <section className="customer-home-grid" aria-label="Account sections">
        <Link to="/account/orders"><span className="customer-home-icon">↻</span><div><strong>Orders</strong><small>{summary.orderCount} order{summary.orderCount === 1 ? '' : 's'}</small></div><span>›</span></Link>
        <Link to="/account/favourites"><span className="customer-home-icon">♥</span><div><strong>Favourites</strong><small>{summary.favouriteCount} saved</small></div><span>›</span></Link>
        <Link to="/account/addresses"><span className="customer-home-icon">⌂</span><div><strong>Addresses</strong><small>{summary.addressCount} saved</small></div><span>›</span></Link>
        <Link to="/account/profile"><span className="customer-home-icon">◉</span><div><strong>Your details</strong><small>Name, mobile and password</small></div><span>›</span></Link>
        <Link to="/restaurants"><span className="customer-home-icon">＋</span><div><strong>Find food</strong><small>Browse restaurants</small></div><span>›</span></Link>
      </section>

      <section className="customer-home-latest">
        <div className="customer-home-section-heading"><div><span>Most recent</span><h2>Latest order</h2></div><Link to="/account/orders">View all</Link></div>
        {summary.latestOrder ? (
          <article>
            <div><span>Order #{summary.latestOrder.order_number}</span><h3>{summary.latestOrder.restaurant_name}</h3><small>{date.format(new Date(summary.latestOrder.created_at))}</small></div>
            <div className="customer-home-order-meta"><strong>{money.format(summary.latestOrder.total_pence / 100)}</strong><span>{formatStatus(summary.latestOrder.order_status)}</span></div>
            <button type="button" onClick={() => void reorderLatest()} disabled={reordering}>{reordering ? 'Building basket…' : 'Order again'}</button>
          </article>
        ) : (
          <div className="customer-home-empty"><p>You have not placed an order yet.</p><Link to="/restaurants">Browse restaurants</Link></div>
        )}
      </section>
    </main>
  )
}