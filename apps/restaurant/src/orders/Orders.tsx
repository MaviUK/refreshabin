import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Orders.css'

type SnapshotOption = {
  id: string
  name: string
  quantity: number
  price_pence: number
}

type SnapshotModifierGroup = {
  group_id: string
  group_name: string
  options: SnapshotOption[]
}

type OrderItem = {
  id: string
  item_name: string
  quantity: number
  unit_price_pence: number
  customer_notes: string | null
  item_snapshot: {
    removed_ingredients?: Array<{ id: string; name: string }>
    selected_extras?: SnapshotOption[]
    modifier_groups?: SnapshotModifierGroup[]
  } | null
}

type Order = {
  id: string
  order_number: number
  restaurant_id: string
  customer_first_name: string
  customer_last_name: string
  customer_email: string
  customer_phone: string
  fulfilment_method: 'delivery' | 'collection'
  address_line_1: string | null
  address_line_2: string | null
  town_city: string | null
  postcode: string | null
  delivery_instructions: string | null
  subtotal_pence: number
  delivery_fee_pence: number
  discount_pence: number
  total_pence: number
  payment_status: string
  order_status: string
  created_at: string
  paid_at: string | null
  estimated_ready_at: string | null
  order_items: OrderItem[]
}

type RestaurantMembership = {
  restaurant_id: string
  restaurants: { name: string } | { name: string }[] | null
}

type LiveStatus = 'connecting' | 'live' | 'offline'

const activeStatuses = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']
const preparationChoices = [15, 20, 30, 45]
const soundStorageKey = 'ordered-food-restaurant-order-sound'
const statusLabels: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

function restaurantName(value: RestaurantMembership['restaurants']) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Restaurant'
  return value?.name ?? 'Restaurant'
}

function modifierLines(item: OrderItem) {
  const snapshot = item.item_snapshot
  if (!snapshot) return []

  const lines: string[] = []
  for (const ingredient of snapshot.removed_ingredients ?? []) lines.push(`No ${ingredient.name}`)
  for (const extra of snapshot.selected_extras ?? []) lines.push(`+ ${extra.quantity > 1 ? `${extra.quantity} × ` : ''}${extra.name}`)
  for (const group of snapshot.modifier_groups ?? []) {
    for (const option of group.options ?? []) {
      lines.push(`${group.group_name}: ${option.quantity > 1 ? `${option.quantity} × ` : ''}${option.name}`)
    }
  }
  return lines
}

function initialSoundPreference() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(soundStorageKey) === 'enabled'
}

export default function Orders() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState('')
  const [restaurant, setRestaurant] = useState('Restaurant')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState('')
  const [view, setView] = useState<'active' | 'completed'>('active')
  const [soundEnabled, setSoundEnabled] = useState(initialSoundPreference)
  const [choosingTimeFor, setChoosingTimeFor] = useState('')
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const soundEnabledRef = useRef(soundEnabled)
  const mountedRef = useRef(true)

  useEffect(() => {
    soundEnabledRef.current = soundEnabled
    if (soundEnabled) window.localStorage.setItem(soundStorageKey, 'enabled')
    else window.localStorage.removeItem(soundStorageKey)
  }, [soundEnabled])

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const loadOrders = useCallback(async (id: string, silent = false) => {
    if (!silent) setRefreshing(true)
    const { data, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        restaurant_id,
        customer_first_name,
        customer_last_name,
        customer_email,
        customer_phone,
        fulfilment_method,
        address_line_1,
        address_line_2,
        town_city,
        postcode,
        delivery_instructions,
        subtotal_pence,
        delivery_fee_pence,
        discount_pence,
        total_pence,
        payment_status,
        order_status,
        created_at,
        paid_at,
        estimated_ready_at,
        order_items (
          id,
          item_name,
          quantity,
          unit_price_pence,
          customer_notes,
          item_snapshot
        )
      `)
      .eq('restaurant_id', id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (!mountedRef.current) return
    if (!silent) setRefreshing(false)
    if (ordersError) throw ordersError
    setOrders((data ?? []) as Order[])
  }, [])

  function playOrderAlert() {
    if (!soundEnabledRef.current) return
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const ring = (start: number, frequency: number) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = frequency
        oscillator.type = 'sine'
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.38)
      }
      const now = context.currentTime
      ring(now, 880)
      ring(now + 0.42, 1100)
      window.setTimeout(() => void context.close(), 1200)
    } catch {
      // Browsers can block audio until the user has interacted with the page.
    }
  }

  function enableSound() {
    setSoundEnabled(true)
    soundEnabledRef.current = true
    playOrderAlert()
  }

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function initialise() {
      try {
        setLoading(true)
        setError('')
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          navigate('/login', { replace: true, state: { from: '/orders' } })
          return
        }

        const { data: membership, error: membershipError } = await supabase
          .from('restaurant_members')
          .select('restaurant_id, restaurants(name)')
          .eq('user_id', userData.user.id)
          .limit(1)
          .maybeSingle()

        if (membershipError) throw membershipError
        if (!membership) {
          navigate('/onboarding', { replace: true })
          return
        }

        const typedMembership = membership as RestaurantMembership
        setRestaurantId(typedMembership.restaurant_id)
        setRestaurant(restaurantName(typedMembership.restaurants))
        await loadOrders(typedMembership.restaurant_id, true)

        channel = supabase
          .channel(`restaurant-orders:${typedMembership.restaurant_id}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'orders',
              filter: `restaurant_id=eq.${typedMembership.restaurant_id}`,
            },
            (payload) => {
              const nextOrder = payload.new as Partial<Order> | undefined
              if (payload.eventType === 'INSERT' || nextOrder?.order_status === 'placed') playOrderAlert()
              void loadOrders(typedMembership.restaurant_id, true).catch(() => setLiveStatus('offline'))
            },
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') setLiveStatus('live')
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveStatus('offline')
            else setLiveStatus('connecting')
          })
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load orders.')
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }

    void initialise()
    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [loadOrders, navigate])

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible' && restaurantId) {
        void loadOrders(restaurantId, true).catch(() => setError('Unable to refresh orders.'))
      }
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [loadOrders, restaurantId])

  const visibleOrders = useMemo(() => orders.filter((order) => {
    const isActive = activeStatuses.includes(order.order_status)
    return view === 'active' ? isActive : !isActive && order.order_status !== 'pending_payment'
  }), [orders, view])

  const newCount = orders.filter((order) => order.order_status === 'placed').length

  async function setOrderStatus(order: Order, orderStatus: string, preparationMinutes?: number) {
    if (!restaurantId || updatingId) return
    if ((orderStatus === 'rejected' || orderStatus === 'cancelled') && !window.confirm(`Are you sure you want to ${orderStatus === 'rejected' ? 'reject' : 'cancel'} order #${order.order_number}?`)) return

    setUpdatingId(order.id)
    setError('')

    const now = new Date().toISOString()
    const patch: Record<string, string | null> = { order_status: orderStatus }
    if (orderStatus === 'accepted') {
      patch.accepted_at = now
      patch.estimated_ready_at = new Date(Date.now() + (preparationMinutes ?? 20) * 60_000).toISOString()
    }
    if (orderStatus === 'completed') patch.completed_at = now
    if (orderStatus === 'rejected' || orderStatus === 'cancelled') patch.cancelled_at = now

    const { data, error: updateError } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', order.id)
      .eq('restaurant_id', restaurantId)
      .eq('order_status', order.order_status)
      .select('id')
      .maybeSingle()

    if (updateError) {
      setError(updateError.message)
    } else if (!data) {
      setError(`Order #${order.order_number} changed on another device. The latest status has been loaded.`)
      await loadOrders(restaurantId, true).catch(() => undefined)
    } else {
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...patch } : item))
      setChoosingTimeFor('')
    }
    setUpdatingId('')
  }

  function nextActions(order: Order) {
    switch (order.order_status) {
      case 'placed':
        return (
          <>
            {choosingTimeFor === order.id ? (
              <div className="prep-time-picker">
                <span>Ready in</span>
                {preparationChoices.map((minutes) => (
                  <button key={minutes} type="button" onClick={() => void setOrderStatus(order, 'accepted', minutes)} disabled={updatingId === order.id}>{minutes} min</button>
                ))}
                <button className="cancel" type="button" onClick={() => setChoosingTimeFor('')}>Cancel</button>
              </div>
            ) : (
              <button className="order-action primary" type="button" onClick={() => setChoosingTimeFor(order.id)} disabled={Boolean(updatingId)}>Accept order</button>
            )}
            <button className="order-action danger" type="button" onClick={() => void setOrderStatus(order, 'rejected')} disabled={Boolean(updatingId)}>Reject</button>
          </>
        )
      case 'accepted':
        return <button className="order-action primary" type="button" onClick={() => void setOrderStatus(order, 'preparing')} disabled={Boolean(updatingId)}>Start preparing</button>
      case 'preparing':
        return <button className="order-action primary" type="button" onClick={() => void setOrderStatus(order, 'ready')} disabled={Boolean(updatingId)}>Mark ready</button>
      case 'ready':
        return order.fulfilment_method === 'delivery'
          ? <button className="order-action primary" type="button" onClick={() => void setOrderStatus(order, 'out_for_delivery')} disabled={Boolean(updatingId)}>Out for delivery</button>
          : <button className="order-action primary" type="button" onClick={() => void setOrderStatus(order, 'completed')} disabled={Boolean(updatingId)}>Collected</button>
      case 'out_for_delivery':
        return <button className="order-action primary" type="button" onClick={() => void setOrderStatus(order, 'completed')} disabled={Boolean(updatingId)}>Mark delivered</button>
      default:
        return null
    }
  }

  if (loading) return <main className="orders-state">Loading orders…</main>

  return (
    <main className="orders-page">
      <header className="orders-header">
        <div>
          <Link className="orders-brand" to="/dashboard">ordered.food</Link>
          <p>{restaurant}</p>
        </div>
        <nav>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/menu">Menu</Link>
        </nav>
      </header>

      <section className="orders-title-row">
        <div>
          <span className="orders-eyebrow">Live order management</span>
          <h1>Orders</h1>
          <p>New paid orders appear here automatically.</p>
        </div>
        <div className="orders-title-actions">
          <div className={`order-live-status order-live-status--${liveStatus}`} role="status">
            {liveStatus === 'live' ? 'Live' : liveStatus === 'offline' ? 'Offline' : 'Connecting'}
          </div>
          <button className={soundEnabled ? 'sound-toggle enabled' : 'sound-toggle'} type="button" onClick={soundEnabled ? () => setSoundEnabled(false) : enableSound}>{soundEnabled ? '🔔 Sound on' : '🔕 Enable sound'}</button>
          <button className="sound-toggle" type="button" disabled={refreshing || !restaurantId} onClick={() => restaurantId && void loadOrders(restaurantId).catch((caughtError) => setError(caughtError instanceof Error ? caughtError.message : 'Unable to refresh orders.'))}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          {newCount > 0 && <div className="new-order-count">{newCount} new</div>}
        </div>
      </section>

      <div className="orders-tabs" role="tablist" aria-label="Order views">
        <button type="button" role="tab" aria-selected={view === 'active'} className={view === 'active' ? 'active' : ''} onClick={() => setView('active')}>Active</button>
        <button type="button" role="tab" aria-selected={view === 'completed'} className={view === 'completed' ? 'active' : ''} onClick={() => setView('completed')}>History</button>
      </div>

      {error && <p className="orders-error" role="alert">{error}</p>}

      {!visibleOrders.length ? (
        <section className="orders-empty">
          <span>{view === 'active' ? '🍽️' : '🧾'}</span>
          <h2>{view === 'active' ? 'No active orders' : 'No order history yet'}</h2>
          <p>{view === 'active' ? 'Paid customer orders will appear here in real time.' : 'Completed, rejected and cancelled orders will appear here.'}</p>
        </section>
      ) : (
        <section className="orders-list">
          {visibleOrders.map((order) => (
            <article className={`order-card status-${order.order_status}`} key={order.id} aria-busy={updatingId === order.id}>
              <div className="order-card-header">
                <div>
                  <span className="order-number">Order #{order.order_number}</span>
                  <strong>{order.customer_first_name} {order.customer_last_name}</strong>
                  <small>{time.format(new Date(order.created_at))} · {order.fulfilment_method}</small>
                  {order.estimated_ready_at && activeStatuses.includes(order.order_status) && <small className="ready-time">Due {time.format(new Date(order.estimated_ready_at))}</small>}
                </div>
                <div className="order-card-total">
                  <span className={`order-status ${order.order_status}`}>{statusLabels[order.order_status] ?? order.order_status}</span>
                  <strong>{money.format(order.total_pence / 100)}</strong>
                </div>
              </div>

              <div className="order-items">
                {order.order_items.map((item) => (
                  <div key={item.id}>
                    <span>
                      <b>{item.quantity}× {item.item_name}</b>
                      {modifierLines(item).map((line, index) => <small key={`${item.id}-${index}`}>{line}</small>)}
                      {item.customer_notes ? <small className="kitchen-note">Note: {item.customer_notes}</small> : null}
                    </span>
                    <strong>{money.format((item.unit_price_pence * item.quantity) / 100)}</strong>
                  </div>
                ))}
                {order.discount_pence > 0 && <div><span>Discount</span><strong>−{money.format(order.discount_pence / 100)}</strong></div>}
                {order.delivery_fee_pence > 0 && <div><span>Delivery fee</span><strong>{money.format(order.delivery_fee_pence / 100)}</strong></div>}
              </div>

              <div className="order-details">
                <div><span>Contact</span><a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a><a href={`mailto:${order.customer_email}`}>{order.customer_email}</a></div>
                {order.fulfilment_method === 'delivery' && (
                  <div><span>Delivery address</span><p>{[order.address_line_1, order.address_line_2, order.town_city, order.postcode].filter(Boolean).join(', ')}</p></div>
                )}
                {order.delivery_instructions && <div><span>Instructions</span><p>{order.delivery_instructions}</p></div>}
              </div>

              {activeStatuses.includes(order.order_status) && <div className="order-actions">{nextActions(order)}</div>}
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
