import { useEffect, useMemo, useRef, useState } from 'react'
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

type OrderStep = { key: string; label: string }
type NotificationState = 'unsupported' | 'default' | 'denied' | 'enabled'

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const notificationStorageKey = 'ordered-food-order-notifications'

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
  return mapping[order.order_status] ?? 0
}

function statusMessage(order: CustomerOrder) {
  if (isCancelled(order)) return order.rejection_reason || 'This order was cancelled.'
  if (order.order_status === 'pending_payment') return 'Payment has not been completed yet.'
  if (['paid', 'received'].includes(order.order_status)) return 'The restaurant has received your order.'
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

function sortOrders(orders: CustomerOrder[]) {
  return [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function getInitialNotificationState(): NotificationState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'granted' && window.localStorage.getItem(notificationStorageKey) === 'enabled') return 'enabled'
  return 'default'
}

export default function CustomerOrders() {
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const [customerUserId, setCustomerUserId] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [updateNotice, setUpdateNotice] = useState('')
  const [notificationState, setNotificationState] = useState<NotificationState>(getInitialNotificationState)
  const orderStatuses = useRef<Record<string, string>>({})
  const noticeTimer = useRef<number | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    async function loadOrders() {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        navigate('/account/login', { replace: true, state: { from: '/account/orders' } })
        return
      }
      setCustomerUserId(user.id)
      await supabase.rpc('claim_customer_orders')
      const { data, error: historyError } = await supabase.rpc('get_customer_order_history')
      if (historyError) setError(historyError.message)
      else {
        const loadedOrders = sortOrders((data || []) as CustomerOrder[])
        orderStatuses.current = Object.fromEntries(loadedOrders.map((order) => [order.id, order.order_status]))
        setOrders(loadedOrders)
      }
      setLoading(false)
    }
    void loadOrders()
  }, [navigate])

  useEffect(() => {
    if (!customerUserId) return

    const channel = supabase
      .channel(`customer-orders:${customerUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `customer_user_id=eq.${customerUserId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const removed = payload.old as Pick<CustomerOrder, 'id'>
            delete orderStatuses.current[removed.id]
            setOrders((current) => current.filter((order) => order.id !== removed.id))
            return
          }

          const changed = payload.new as CustomerOrder
          const previousStatus = orderStatuses.current[changed.id]
          orderStatuses.current[changed.id] = changed.order_status
          setOrders((current) => {
            const exists = current.some((order) => order.id === changed.id)
            const next = exists
              ? current.map((order) => (order.id === changed.id ? { ...order, ...changed } : order))
              : [changed, ...current]
            return sortOrders(next)
          })
          setNow(Date.now())

          const statusChanged = previousStatus !== undefined && previousStatus !== changed.order_status
          const notice = `Order #${changed.order_number} is now ${formatStatus(changed.order_status).toLowerCase()}.`
          if (statusChanged) {
            setUpdateNotice(notice)
            if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
            noticeTimer.current = window.setTimeout(() => setUpdateNotice(''), 6000)

            if (notificationState === 'enabled' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
              const notification = new Notification(`${changed.restaurant_name} order update`, {
                body: `${notice} ${statusMessage(changed)}`,
                tag: `ordered-food-order-${changed.id}`,
              })
              notification.onclick = () => {
                window.focus()
                notification.close()
              }
            }
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveStatus('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveStatus('offline')
        else setLiveStatus('connecting')
      })

    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [customerUserId, notificationState])

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

  async function toggleNotifications() {
    if (notificationState === 'unsupported' || notificationState === 'denied') return
    if (notificationState === 'enabled') {
      window.localStorage.removeItem(notificationStorageKey)
      setNotificationState('default')
      return
    }

    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      window.localStorage.setItem(notificationStorageKey, 'enabled')
      setNotificationState('enabled')
    } else {
      setNotificationState(permission === 'denied' ? 'denied' : 'default')
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
  }

  async function reorder(order: CustomerOrder) {
    if (reorderingId) return
    setError('')
    setReorderingId(order.id)

    const { data, error: reorderError } = await supabase.rpc('get_customer_reorder_basket', { target_order_id: order.id })
    if (reorderError) {
      setError(reorderError.message)
      setReorderingId(null)
      return
    }

    const result = data as ReorderResponse
    if (!result.items.length) {
      setError('None of the items from this order are currently available.')
      setReorderingId(null)
      return
    }

    const warnings: string[] = []
    if (result.unavailable_items.length) warnings.push(`${result.unavailable_items.length} item${result.unavailable_items.length === 1 ? '' : 's'} are no longer available and will be left out.`)
    if (result.price_changed_items.length) warnings.push(`${result.price_changed_items.length} item${result.price_changed_items.length === 1 ? ' has' : 's have'} changed price.`)

    if (warnings.length && !window.confirm(`${warnings.join('\n')}\n\nContinue with the available items?`)) {
      setReorderingId(null)
      return
    }

    const basket = Object.fromEntries(result.items.map((item) => [item.line_id, item]))
    window.localStorage.setItem(`ordered-food-basket:${result.restaurant_slug}`, JSON.stringify(basket))
    navigate(`/r/${result.restaurant_slug}`)
  }

  function renderOrder(order: CustomerOrder, active: boolean) {
    const steps = getSteps(order)
    const currentStep = getStepIndex(order)
    const eta = etaLabel(order, now)
    const cancelled = isCancelled(order)

    return (
      <article className={`customer-order-card${active ? ' customer-order-card--active' : ''}${cancelled ? ' customer-order-card--cancelled' : ''}`} key={order.id}>
        <div className="customer-order-topline">
          <div><span>Order #{order.order_number}</span><h2>{order.restaurant_name}</h2></div>
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
              return <div className={`customer-order-step customer-order-step--${state}`} key={step.key}><span className="customer-order-step-dot" aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</span><span>{step.label}</span></div>
            })}
          </div>
        )}
        <div className={`customer-order-message${cancelled ? ' customer-order-message--cancelled' : ''}`}><strong>{statusMessage(order)}</strong>{eta && <span>{eta}</span>}</div>
        <div className="customer-order-actions">
          {order.stripe_checkout_session_id && <Link to={`/order/success?session_id=${encodeURIComponent(order.stripe_checkout_session_id)}`}>View order</Link>}
          <button type="button" onClick={() => void reorder(order)} disabled={reorderingId === order.id}>{reorderingId === order.id ? 'Building basket…' : 'Order again'}</button>
        </div>
      </article>
    )
  }

  return (
    <main className="customer-account-shell customer-account-shell--wide">
      <section className="customer-account-card">
        <header className="customer-account-header">
          <div><Link className="customer-account-brand" to="/">ordered.food</Link><span className="customer-account-eyebrow">Customer account</span><h1>My orders</h1></div>
          <button className="customer-account-secondary" type="button" onClick={signOut}>Sign out</button>
        </header>
        <div className="customer-order-tools">
          <div className={`customer-order-live customer-order-live--${liveStatus}`} role="status">
            <span aria-hidden="true" />
            {liveStatus === 'live' ? 'Live updates on' : liveStatus === 'offline' ? 'Live updates unavailable' : 'Connecting live updates…'}
          </div>
          {notificationState !== 'unsupported' && (
            <button className="customer-order-notification-toggle" type="button" onClick={() => void toggleNotifications()} disabled={notificationState === 'denied'}>
              {notificationState === 'enabled' ? 'Notifications on' : notificationState === 'denied' ? 'Notifications blocked' : 'Turn on notifications'}
            </button>
          )}
        </div>
        {updateNotice && <div className="customer-order-update-notice" role="status">{updateNotice}</div>}
        {loading && <p>Loading your orders…</p>}
        {error && <div className="customer-account-error" role="alert">{error}</div>}
        {!loading && !error && orders.length === 0 && <div className="customer-account-empty"><h2>No orders yet</h2><p>Your paid orders will appear here.</p><Link to="/restaurants">Browse restaurants</Link></div>}
        {!loading && activeOrders.length > 0 && <section className="customer-order-section"><div className="customer-order-section-heading"><div><span className="customer-account-eyebrow">Live</span><h2>Current orders</h2></div></div><div className="customer-order-list">{activeOrders.map((order) => renderOrder(order, true))}</div></section>}
        {!loading && previousOrders.length > 0 && <section className="customer-order-section"><div className="customer-order-section-heading"><div><span className="customer-account-eyebrow">History</span><h2>Previous orders</h2></div></div><div className="customer-order-list">{previousOrders.map((order) => renderOrder(order, false))}</div></section>}
      </section>
    </main>
  )
}
