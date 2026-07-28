import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'

type CustomerOrder = {
  id: string
  order_number: number
  restaurant_name: string
  restaurant_slug: string
  fulfilment_method: 'delivery' | 'collection'
  total_pence: number
  payment_status: string
  order_status: string
  created_at: string
  stripe_checkout_session_id: string | null
  estimated_ready_at: string | null
  rejection_reason: string | null
}

type OrderStep = {
  key: string
  label: string
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isCancelled(order: CustomerOrder) {
  return ['cancelled', 'rejected', 'refunded'].includes(order.order_status)
}

function getSteps(order: CustomerOrder): OrderStep[] {
  if (order.fulfilment_method === 'collection') {
    return [
      { key: 'paid', label: 'Order received' },
      { key: 'accepted', label: 'Accepted' },
      { key: 'preparing', label: 'Preparing' },
      { key: 'ready', label: 'Ready to collect' },
      { key: 'completed', label: 'Collected' },
    ]
  }

  return [
    { key: 'paid', label: 'Order received' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'preparing', label: 'Preparing' },
    { key: 'out_for_delivery', label: 'On the way' },
    { key: 'completed', label: 'Delivered' },
  ]
}

function getStepIndex(order: CustomerOrder) {
  const status = order.order_status
  const mapping: Record<string, number> = {
    pending_payment: -1,
    paid: 0,
    received: 0,
    accepted: 1,
    preparing: 2,
    ready: order.fulfilment_method === 'collection' ? 3 : 2,
    ready_for_collection: 3,
    out_for_delivery: 3,
    completed: 4,
    delivered: 4,
    collected: 4,
  }
  return mapping[status] ?? 0
}

function statusMessage(order: CustomerOrder) {
  if (isCancelled(order)) return order.rejection_reason || 'This order was cancelled.'
  if (order.order_status === 'pending_payment') return 'Payment has not been completed yet.'
  if (order.order_status === 'paid' || order.order_status === 'received') return 'The restaurant has received your order.'
  if (order.order_status === 'accepted') return 'The restaurant has accepted your order.'
  if (order.order_status === 'preparing') return 'Your food is being prepared.'
  if (['ready', 'ready_for_collection'].includes(order.order_status)) return 'Your order is ready to collect.'
  if (order.order_status === 'out_for_delivery') return 'Your order is on the way.'
  if (['completed', 'delivered', 'collected'].includes(order.order_status)) return 'Your order is complete.'
  return formatStatus(order.order_status)
}

function etaLabel(order: CustomerOrder, now: number) {
  if (!order.estimated_ready_at || isCancelled(order)) return null
  const eta = new Date(order.estimated_ready_at)
  const minutes = Math.ceil((eta.getTime() - now) / 60000)
  if (minutes > 1) return `Estimated ${order.fulfilment_method === 'delivery' ? 'delivery' : 'ready'} in ${minutes} mins (${timeOnly.format(eta)})`
  if (minutes >= 0) return `Estimated ${order.fulfilment_method === 'delivery' ? 'delivery' : 'ready'} now`
  return `Estimated time was ${timeOnly.format(eta)}`
}

export default function CustomerOrders() {
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const navigate = useNavigate()

  useEffect(() => {
    async function loadOrders() {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        navigate('/account/login', { replace: true, state: { from: '/account/orders' } })
        return
      }

      await supabase.rpc('claim_customer_orders')
      const { data, error: historyError } = await supabase.rpc('get_customer_order_history')
      if (historyError) setError(historyError.message)
      else setOrders((data || []) as CustomerOrder[])
      setLoading(false)
    }

    void loadOrders()
  }, [navigate])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  const activeOrders = useMemo(
    () => orders.filter((order) => !isCancelled(order) && !['completed', 'delivered', 'collected'].includes(order.order_status)),
    [orders],
  )
  const previousOrders = useMemo(
    () => orders.filter((order) => !activeOrders.some((activeOrder) => activeOrder.id === order.id)),
    [activeOrders, orders],
  )

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
  }

  function renderOrder(order: CustomerOrder, active: boolean) {
    const steps = getSteps(order)
    const currentStep = getStepIndex(order)
    const eta = etaLabel(order, now)
    const cancelled = isCancelled(order)

    return (
      <article className={`customer-order-card${active ? ' customer-order-card--active' : ''}${cancelled ? ' customer-order-card--cancelled' : ''}`} key={order.id}>
        <div className="customer-order-topline">
          <div>
            <span>Order #{order.order_number}</span>
            <h2>{order.restaurant_name}</h2>
          </div>
          <strong>{money.format(order.total_pence / 100)}</strong>
        </div>

        <div className="customer-order-summary-row">
          <span className={`customer-order-status-pill${cancelled ? ' customer-order-status-pill--cancelled' : ''}`}>{formatStatus(order.order_status)}</span>
          <span>{formatStatus(order.fulfilment_method)}</span>
          <span>{dateTime.format(new Date(order.created_at))}</span>
        </div>

        {active && !cancelled && (
          <div className="customer-order-tracker" aria-label="Order progress">
            {steps.map((step, index) => {
              const state = index < currentStep ? 'complete' : index === currentStep ? 'current' : 'upcoming'
              return (
                <div className={`customer-order-step customer-order-step--${state}`} key={step.key}>
                  <span className="customer-order-step-dot" aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</span>
                  <span>{step.label}</span>
                </div>
              )
            })}
          </div>
        )}

        <div className={`customer-order-message${cancelled ? ' customer-order-message--cancelled' : ''}`}>
          <strong>{statusMessage(order)}</strong>
          {eta && <span>{eta}</span>}
        </div>

        <div className="customer-order-actions">
          {order.stripe_checkout_session_id && (
            <Link to={`/order/success?session_id=${encodeURIComponent(order.stripe_checkout_session_id)}`}>View order</Link>
          )}
          <Link to={`/r/${order.restaurant_slug}`}>Order again</Link>
        </div>
      </article>
    )
  }

  return (
    <main className="customer-account-shell customer-account-shell--wide">
      <section className="customer-account-card">
        <header className="customer-account-header">
          <div>
            <Link className="customer-account-brand" to="/">ordered.food</Link>
            <span className="customer-account-eyebrow">Customer account</span>
            <h1>My orders</h1>
          </div>
          <button className="customer-account-secondary" type="button" onClick={signOut}>Sign out</button>
        </header>

        {loading && <p>Loading your orders…</p>}
        {error && <div className="customer-account-error" role="alert">{error}</div>}
        {!loading && !error && orders.length === 0 && (
          <div className="customer-account-empty">
            <h2>No orders yet</h2>
            <p>Your paid orders will appear here.</p>
            <Link to="/restaurants">Browse restaurants</Link>
          </div>
        )}

        {!loading && !error && activeOrders.length > 0 && (
          <section className="customer-order-section">
            <div className="customer-order-section-heading">
              <div>
                <span className="customer-account-eyebrow">Live</span>
                <h2>Current orders</h2>
              </div>
            </div>
            <div className="customer-order-list">{activeOrders.map((order) => renderOrder(order, true))}</div>
          </section>
        )}

        {!loading && !error && previousOrders.length > 0 && (
          <section className="customer-order-section">
            <div className="customer-order-section-heading">
              <div>
                <span className="customer-account-eyebrow">History</span>
                <h2>Previous orders</h2>
              </div>
            </div>
            <div className="customer-order-list">{previousOrders.map((order) => renderOrder(order, false))}</div>
          </section>
        )}
      </section>
    </main>
  )
}
