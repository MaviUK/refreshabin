import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './KitchenDisplay.css'

type SnapshotOption = {
  id: string
  name: string
  quantity: number
}

type OrderItem = {
  id: string
  item_name: string
  quantity: number
  customer_notes: string | null
  item_snapshot: {
    removed_ingredients?: Array<{ id: string; name: string }>
    selected_extras?: SnapshotOption[]
    modifier_groups?: Array<{
      group_id: string
      group_name: string
      options: SnapshotOption[]
    }>
  } | null
}

type KitchenOrder = {
  id: string
  order_number: number
  restaurant_id: string
  customer_first_name: string
  fulfilment_method: 'delivery' | 'collection'
  order_status: string
  created_at: string
  delivery_instructions: string | null
  order_items: OrderItem[]
}

type Membership = {
  restaurant_id: string
  restaurants: { name: string } | { name: string }[] | null
}

type LiveStatus = 'connecting' | 'live' | 'offline'

const kitchenStatuses = ['placed', 'accepted', 'preparing', 'ready']
const soundStorageKey = 'ordered-food-kds-sound'

function getRestaurantName(value: Membership['restaurants']) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Kitchen'
  return value?.name ?? 'Kitchen'
}

function elapsedMinutes(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000))
}

function initialSoundPreference() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(soundStorageKey) === 'enabled'
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

export default function KitchenDisplay() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState('')
  const [restaurantName, setRestaurantName] = useState('Kitchen')
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState('')
  const [now, setNow] = useState(Date.now())
  const [soundEnabled, setSoundEnabled] = useState(initialSoundPreference)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const knownOrderIds = useRef<Set<string>>(new Set())
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

  const playAlert = useCallback(() => {
    if (!soundEnabledRef.current) return
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const ring = (start: number, frequency: number) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.38)
      }
      ring(context.currentTime, 880)
      ring(context.currentTime + 0.42, 1100)
      window.setTimeout(() => void context.close(), 1200)
    } catch {
      // Audio can be blocked until the screen has been interacted with.
    }
  }, [])

  const loadOrders = useCallback(async (id: string, options: { announceNew?: boolean; showRefresh?: boolean } = {}) => {
    if (options.showRefresh) setRefreshing(true)
    const { data, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        restaurant_id,
        customer_first_name,
        fulfilment_method,
        order_status,
        created_at,
        delivery_instructions,
        order_items (
          id,
          item_name,
          quantity,
          customer_notes,
          item_snapshot
        )
      `)
      .eq('restaurant_id', id)
      .in('order_status', kitchenStatuses)
      .order('created_at', { ascending: true })

    if (!mountedRef.current) return
    if (options.showRefresh) setRefreshing(false)
    if (ordersError) throw ordersError

    const nextOrders = (data ?? []) as KitchenOrder[]
    if (options.announceNew) {
      const hasNewPlacedOrder = nextOrders.some((order) => order.order_status === 'placed' && !knownOrderIds.current.has(order.id))
      if (hasNewPlacedOrder) playAlert()
    }

    knownOrderIds.current = new Set(nextOrders.map((order) => order.id))
    setOrders(nextOrders)
  }, [playAlert])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function initialise() {
      try {
        setLoading(true)
        setError('')
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          navigate('/login', { replace: true, state: { from: '/kds' } })
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

        const typedMembership = membership as Membership
        setRestaurantId(typedMembership.restaurant_id)
        setRestaurantName(getRestaurantName(typedMembership.restaurants))
        await loadOrders(typedMembership.restaurant_id)

        channel = supabase
          .channel(`kds-orders:${typedMembership.restaurant_id}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'orders',
              filter: `restaurant_id=eq.${typedMembership.restaurant_id}`,
            },
            () => {
              void loadOrders(typedMembership.restaurant_id, { announceNew: true }).catch(() => setLiveStatus('offline'))
            },
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') setLiveStatus('live')
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLiveStatus('offline')
            else setLiveStatus('connecting')
          })
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load kitchen orders.')
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
        void loadOrders(restaurantId).catch(() => setError('Unable to refresh kitchen orders.'))
      }
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [loadOrders, restaurantId])

  const columns = useMemo(() => ({
    new: orders.filter((order) => order.order_status === 'placed'),
    preparing: orders.filter((order) => order.order_status === 'accepted' || order.order_status === 'preparing'),
    ready: orders.filter((order) => order.order_status === 'ready'),
  }), [orders])

  async function updateStatus(order: KitchenOrder, status: string) {
    if (!restaurantId || updatingId) return
    setUpdatingId(order.id)
    setError('')

    const timestamp = new Date().toISOString()
    const patch: Record<string, string> = { order_status: status }
    if (status === 'accepted') patch.accepted_at = timestamp
    if (status === 'completed') patch.completed_at = timestamp

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
      setError(`Order #${order.order_number} changed on another screen. The latest status has been loaded.`)
    }

    await loadOrders(restaurantId).catch(() => setError('The order changed, but the kitchen board could not be refreshed.'))
    if (mountedRef.current) setUpdatingId('')
  }

  async function enterFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setError('Fullscreen mode could not be changed on this device.')
    }
  }

  function enableSound() {
    setSoundEnabled(true)
    soundEnabledRef.current = true
    playAlert()
  }

  function ticket(order: KitchenOrder) {
    const age = elapsedMinutes(order.created_at, now)
    const urgency = age >= 20 ? 'late' : age >= 10 ? 'warning' : 'normal'
    const nextStatus = order.order_status === 'placed'
      ? 'accepted'
      : order.order_status === 'accepted'
        ? 'preparing'
        : order.order_status === 'preparing'
          ? 'ready'
          : order.fulfilment_method === 'collection' ? 'completed' : 'out_for_delivery'
    const actionLabel = order.order_status === 'placed'
      ? 'Accept'
      : order.order_status === 'accepted'
        ? 'Start'
        : order.order_status === 'preparing'
          ? 'Ready'
          : order.fulfilment_method === 'collection' ? 'Collected' : 'Dispatched'

    return (
      <article className={`kds-ticket ${urgency}`} key={order.id} aria-busy={updatingId === order.id}>
        <header>
          <div>
            <strong>#{order.order_number}</strong>
            <span>{order.customer_first_name} · {order.fulfilment_method}</span>
          </div>
          <time dateTime={order.created_at}>{age}m</time>
        </header>

        <div className="kds-items">
          {order.order_items.map((item) => (
            <div key={item.id}>
              <b>{item.quantity}</b>
              <span>
                {item.item_name}
                {modifierLines(item).map((line, index) => <small key={`${item.id}-${index}`}>{line}</small>)}
                {item.customer_notes ? <small className="kitchen-note">Note: {item.customer_notes}</small> : null}
              </span>
            </div>
          ))}
        </div>

        {order.delivery_instructions && <p className="kds-note">Delivery: {order.delivery_instructions}</p>}

        <button type="button" onClick={() => void updateStatus(order, nextStatus)} disabled={Boolean(updatingId)}>
          {updatingId === order.id ? 'Updating…' : actionLabel}
        </button>
      </article>
    )
  }

  if (loading) return <main className="kds-state">Loading kitchen display…</main>

  return (
    <main className="kds-page">
      <header className="kds-topbar">
        <div>
          <Link to="/orders">← Orders</Link>
          <strong>{restaurantName} Kitchen</strong>
        </div>
        <div className="kds-controls">
          <span className={`kds-live-status kds-live-status--${liveStatus}`} role="status">
            {liveStatus === 'live' ? 'Live' : liveStatus === 'offline' ? 'Offline' : 'Connecting'}
          </span>
          <button type="button" className={soundEnabled ? 'enabled' : ''} onClick={soundEnabled ? () => setSoundEnabled(false) : enableSound}>
            {soundEnabled ? 'Sound on' : 'Enable sound'}
          </button>
          <button type="button" disabled={refreshing || !restaurantId} onClick={() => restaurantId && void loadOrders(restaurantId, { showRefresh: true }).catch((caughtError) => setError(caughtError instanceof Error ? caughtError.message : 'Unable to refresh kitchen orders.'))}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" onClick={() => void enterFullscreen()}>{document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'}</button>
        </div>
      </header>

      {error && <p className="kds-error" role="alert">{error}</p>}

      <section className="kds-board" aria-label="Kitchen order board">
        <div className="kds-column new">
          <header><h1>New</h1><span>{columns.new.length}</span></header>
          <div>{columns.new.map(ticket)}</div>
        </div>
        <div className="kds-column preparing">
          <header><h1>Preparing</h1><span>{columns.preparing.length}</span></header>
          <div>{columns.preparing.map(ticket)}</div>
        </div>
        <div className="kds-column ready">
          <header><h1>Ready</h1><span>{columns.ready.length}</span></header>
          <div>{columns.ready.map(ticket)}</div>
        </div>
      </section>
    </main>
  )
}
