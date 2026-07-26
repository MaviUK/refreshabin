import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './KitchenDisplay.css'

type OrderItem = {
  id: string
  item_name: string
  quantity: number
  customer_notes: string | null
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

const kitchenStatuses = ['placed', 'accepted', 'preparing', 'ready']

function getRestaurantName(value: Membership['restaurants']) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Kitchen'
  return value?.name ?? 'Kitchen'
}

function elapsedMinutes(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000))
}

export default function KitchenDisplay() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState('')
  const [restaurantName, setRestaurantName] = useState('Kitchen')
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState('')
  const [now, setNow] = useState(Date.now())
  const [soundEnabled, setSoundEnabled] = useState(false)
  const knownOrderIds = useRef<Set<string>>(new Set())

  const playAlert = useCallback(() => {
    if (!soundEnabled) return
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.15, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.8)
  }, [soundEnabled])

  const loadOrders = useCallback(async (id: string, announceNew = false) => {
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
          customer_notes
        )
      `)
      .eq('restaurant_id', id)
      .in('order_status', kitchenStatuses)
      .order('created_at', { ascending: true })

    if (ordersError) throw ordersError
    const nextOrders = (data ?? []) as KitchenOrder[]

    if (announceNew) {
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
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          navigate('/login', { replace: true })
          return
        }

        const { data: membership, error: membershipError } = await supabase
          .from('restaurant_members')
          .select('restaurant_id, restaurants(name)')
          .eq('user_id', userData.user.id)
          .limit(1)
          .single()

        if (membershipError) throw membershipError
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
            () => loadOrders(typedMembership.restaurant_id, true),
          )
          .subscribe()
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load kitchen orders.')
      } finally {
        setLoading(false)
      }
    }

    initialise()
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadOrders, navigate])

  const columns = useMemo(() => ({
    new: orders.filter((order) => order.order_status === 'placed'),
    preparing: orders.filter((order) => order.order_status === 'accepted' || order.order_status === 'preparing'),
    ready: orders.filter((order) => order.order_status === 'ready'),
  }), [orders])

  async function updateStatus(order: KitchenOrder, status: string) {
    if (!restaurantId || updatingId) return
    setUpdatingId(order.id)
    setError('')

    const { error: updateError } = await supabase
      .from('orders')
      .update({ order_status: status })
      .eq('id', order.id)
      .eq('restaurant_id', restaurantId)

    if (updateError) {
      setError(updateError.message)
    } else {
      await loadOrders(restaurantId)
    }
    setUpdatingId('')
  }

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      setError('Fullscreen mode could not be opened on this device.')
    }
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
          : 'completed'
    const actionLabel = order.order_status === 'placed'
      ? 'Accept'
      : order.order_status === 'accepted'
        ? 'Start'
        : order.order_status === 'preparing'
          ? 'Ready'
          : order.fulfilment_method === 'collection' ? 'Collected' : 'Dispatched'

    return (
      <article className={`kds-ticket ${urgency}`} key={order.id}>
        <header>
          <div>
            <strong>#{order.order_number}</strong>
            <span>{order.customer_first_name} · {order.fulfilment_method}</span>
          </div>
          <time>{age}m</time>
        </header>

        <div className="kds-items">
          {order.order_items.map((item) => (
            <div key={item.id}>
              <b>{item.quantity}</b>
              <span>{item.item_name}{item.customer_notes ? <small>{item.customer_notes}</small> : null}</span>
            </div>
          ))}
        </div>

        {order.delivery_instructions && <p className="kds-note">{order.delivery_instructions}</p>}

        <button onClick={() => updateStatus(order, nextStatus)} disabled={updatingId === order.id}>
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
          <button className={soundEnabled ? 'enabled' : ''} onClick={() => setSoundEnabled((current) => !current)}>
            {soundEnabled ? 'Sound on' : 'Sound off'}
          </button>
          <button onClick={enterFullscreen}>Fullscreen</button>
        </div>
      </header>

      {error && <p className="kds-error">{error}</p>}

      <section className="kds-board">
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
