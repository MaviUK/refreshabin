import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Restaurant = {
  id: string
  name: string
  slug: string
  status: string
  email: string | null
  phone: string | null
}

type DashboardStats = {
  todayOrders: number
  openOrders: number
  revenueToday: number
  categoryCount: number
  itemCount: number
  openingHoursCount: number
  hasLocation: boolean
}

type SetupStep = {
  label: string
  complete: boolean
  to: string
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const activeStatuses = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']

function startOfTodayIso() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [stats, setStats] = useState<DashboardStats>({
    todayOrders: 0,
    openOrders: 0,
    revenueToday: 0,
    categoryCount: 0,
    itemCount: 0,
    openingHoursCount: 0,
    hasLocation: false,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    setError('')

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        navigate('/login', { replace: true, state: { from: '/dashboard' } })
        return
      }

      const { data: membership, error: membershipError } = await supabase
        .from('restaurant_members')
        .select('restaurant_id, restaurants(id,name,slug,status,email,phone)')
        .eq('user_id', userData.user.id)
        .limit(1)
        .maybeSingle()

      if (membershipError) throw membershipError
      if (!membership) {
        navigate('/onboarding', { replace: true })
        return
      }

      const restaurantValue = Array.isArray(membership.restaurants)
        ? membership.restaurants[0]
        : membership.restaurants
      if (!restaurantValue) throw new Error('Restaurant details could not be loaded.')

      const currentRestaurant = restaurantValue as Restaurant
      setRestaurant(currentRestaurant)
      const today = startOfTodayIso()

      const [todayOrdersResult, openOrdersResult, categoryResult, itemResult, locationResult] = await Promise.all([
        supabase
          .from('orders')
          .select('total_pence,payment_status,order_status')
          .eq('restaurant_id', currentRestaurant.id)
          .gte('created_at', today)
          .neq('payment_status', 'unpaid'),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', currentRestaurant.id)
          .in('order_status', activeStatuses),
        supabase
          .from('menu_categories')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', currentRestaurant.id),
        supabase
          .from('menu_items')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', currentRestaurant.id),
        supabase
          .from('restaurant_locations')
          .select('id')
          .eq('restaurant_id', currentRestaurant.id)
          .eq('is_primary', true)
          .limit(1)
          .maybeSingle(),
      ])

      const firstError = [todayOrdersResult.error, openOrdersResult.error, categoryResult.error, itemResult.error, locationResult.error].find(Boolean)
      if (firstError) throw firstError

      const locationId = locationResult.data?.id
      let openingHoursCount = 0
      if (locationId) {
        const { count, error: openingError } = await supabase
          .from('opening_hours')
          .select('id', { count: 'exact', head: true })
          .eq('location_id', locationId)
        if (openingError) throw openingError
        openingHoursCount = count ?? 0
      }

      const paidOrders = (todayOrdersResult.data ?? []).filter((order) => !['pending', 'pending_payment', 'unpaid', 'failed'].includes(order.payment_status))
      setStats({
        todayOrders: paidOrders.length,
        openOrders: openOrdersResult.count ?? 0,
        revenueToday: paidOrders.reduce((total, order) => total + order.total_pence, 0),
        categoryCount: categoryResult.count ?? 0,
        itemCount: itemResult.count ?? 0,
        openingHoursCount,
        hasLocation: Boolean(locationId),
      })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load the dashboard.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [navigate])

  useEffect(() => {
    void loadDashboard(true)
  }, [loadDashboard])

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') void loadDashboard(true)
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadDashboard])

  const setupSteps = useMemo<SetupStep[]>(() => [
    { label: 'Restaurant details', complete: Boolean(restaurant?.name && restaurant.email && restaurant.phone), to: '/onboarding' },
    { label: 'Address and contact details', complete: stats.hasLocation, to: '/onboarding' },
    { label: 'Opening hours', complete: stats.openingHoursCount > 0, to: '/opening-hours' },
    { label: 'Add your first menu category', complete: stats.categoryCount > 0, to: '/menu' },
    { label: 'Add your first product', complete: stats.itemCount > 0, to: '/menu' },
    { label: 'Submit restaurant for approval', complete: restaurant?.status === 'approved' || restaurant?.status === 'active', to: '/onboarding' },
  ], [restaurant, stats])

  const completeCount = setupSteps.filter((step) => step.complete).length
  const progress = Math.round((completeCount / setupSteps.length) * 100)
  const isLive = restaurant?.status === 'approved' || restaurant?.status === 'active'

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  if (loading) return <main className="dashboard-shell"><p>Loading dashboard…</p></main>

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurant?.name ?? 'Restaurant portal'}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void signOut()}>Sign out</button>
      </header>

      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">Your restaurant</span>
          <h1>{greeting()} 👋</h1>
          <p>{isLive ? 'Keep an eye on incoming orders and manage your restaurant.' : 'Finish your setup, build your menu and get ready to accept orders.'}</p>
        </div>
        <div className="dashboard-hero-actions">
          <button className="secondary-button" type="button" disabled={refreshing} onClick={() => void loadDashboard()}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <Link className="primary-button button-link" to={isLive ? '/orders' : '/onboarding'}>{isLive ? 'Manage orders' : 'Continue setup'}</Link>
        </div>
      </section>

      {error && <p className="orders-error" role="alert">{error}</p>}

      <section className="metrics-grid" aria-label="Restaurant summary">
        <article className="metric-card">
          <span>Restaurant status</span>
          <strong className="status-value"><i className="status-dot" /> {isLive ? 'Live' : restaurant?.status?.replaceAll('_', ' ') || 'Setup mode'}</strong>
        </article>
        <article className="metric-card"><span>Today's orders</span><strong>{stats.todayOrders}</strong></article>
        <article className="metric-card"><span>Open orders</span><strong>{stats.openOrders}</strong></article>
        <article className="metric-card"><span>Revenue today</span><strong>{money.format(stats.revenueToday / 100)}</strong></article>
      </section>

      <section className="dashboard-grid">
        <article className="panel-card setup-card">
          <div className="panel-heading">
            <div><span className="eyebrow">Launch checklist</span><h2>Your setup progress</h2></div>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track" role="progressbar" aria-label="Restaurant setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
          <div className="checklist">
            {setupSteps.map((step) => (
              <Link className="checklist-row" key={step.label} to={step.to}>
                <span className={step.complete ? 'check-icon complete' : 'check-icon'}>{step.complete ? '✓' : '○'}</span>
                <span>{step.label}</span><span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-heading"><div><span className="eyebrow">Quick actions</span><h2>Run your restaurant</h2></div></div>
          <div className="quick-actions">
            <Link to="/orders">Manage orders <span>→</span></Link>
            <Link to="/kds">Open kitchen display <span>→</span></Link>
            <Link to="/menu">Build your menu <span>→</span></Link>
            <Link to="/opening-hours">Set opening hours <span>→</span></Link>
            <Link to="/branding">Update branding <span>→</span></Link>
            <Link to="/settings">Restaurant settings <span>→</span></Link>
            <Link to="/printers">Manage printers <span>→</span></Link>
            <Link to="/print-history">View print history <span>→</span></Link>
          </div>
        </article>
      </section>
    </main>
  )
}
