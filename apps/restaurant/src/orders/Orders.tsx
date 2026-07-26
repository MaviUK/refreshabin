import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Orders.css'

type OrderItem = {
  id: string
  item_name: string
  quantity: number
  unit_price_pence: number
  customer_notes: string | null
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
  order_items: OrderItem[]
}

type RestaurantMembership = {
  restaurant_id: string
  restaurants: { name: string } | { name: string }[] | null
}

const activeStatuses = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery']
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

export default function Orders() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState('')
  const [restaurant, setRestaurant] = useState('Restaurant')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState('')
  const [view, setView] = useState<'active' | 'completed'>('active')

  const loadOrders = useCallback(async (id: string) => {
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
        order_items (
          id,
          item_name,
          quantity,
          unit_price_pence,
          customer_notes
        )
      `)
      .eq('restaurant_id', id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (ordersError) throw ordersError
    setOrders((data ?? []) as Order[])
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

        const typedMembership = membership as RestaurantMembership
        setRestaurantId(typedMembership.restaurant_id)
        setRestaurant(restaurantName(typedMembership.restaurants))
        await loadOrders(typedMembership.restaurant_id)

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
            () => loadOrders(typedMembership.restaurant_id),
          )
          .subscribe()
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load orders.')
      } finally {
        setLoading(false)
      }
    }

    initialise()
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadOrders, navigate])

  const visibleOrders = useMemo(() => orders.filter((order) => {
    const isActive = activeStatuses.includes(order.order_status)
    return view === 'active' ? isActive : !isActive && order.order_status !== 'pending_payment'
  }), [orders, view])

  const newCount = orders.filter((order) => order.order_status === 'placed').length

  async function setOrderStatus(order: Order, orderStatus: string) {
    if (!restaurantId || updatingId) return
    setUpdatingId(order.id)
    setError('')

    const { error: updateError } = await supabase
      .from('orders')
      .update({ order_status: orderStatus })
      .eq('id', order.id)
      .eq('restaurant_id', restaurantId)

    if (updateError) {
      setError(updateError.message)
    } else {
      setOrders((current) => current.map((item) => item.id === order.id
        ? { ...item, order_status: orderStatus }
        : item))
    }
    setUpdatingId('')
  }

  function nextActions(order: Order) {
    switch (order.order_status) {
      case 'placed':
        return (
          <>
            <button className="order-action primary" onClick={() => setOrderStatus(order, 'accepted')} disabled={updatingId === order.id}>Accept order</button>
            <button className="order-action danger" onClick={() => setOrderStatus(order, 'rejected')} disabled={updatingId === order.id}>Reject</button>
          </>
        )
      case 'accepted':
        return <button className="order-action primary" onClick={() => setOrderStatus(order, 'preparing')} disabled={updatingId === order.id}>Start preparing</button>
      case 'preparing':
        return <button className="order-action primary" onClick={() => setOrderStatus(order, 'ready')} disabled={updatingId === order.id}>Mark ready</button>
      case 'ready':
        return order.fulfilment_method === 'delivery'
          ? <button className="order-action primary" onClick={() => setOrderStatus(order, 'out_for_delivery')} disabled={updatingId === order.id}>Out for delivery</button>
          : <button className="order-action primary" onClick={() => setOrderStatus(order, 'completed')} disabled={updatingId === order.id}>Collected</button>
      case 'out_for_delivery':
        return <button className="order-action primary" onClick={() => setOrderStatus(order, 'completed')} disabled={updatingId === order.id}>Mark delivered</button>
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
        {newCount > 0 && <div className="new-order-count">{newCount} new</div>}
      </section>

      <div className="orders-tabs" role="tablist">
        <button className={view === 'active' ? 'active' : ''} onClick={() => setView('active')}>Active</button>
        <button className={view === 'completed' ? 'active' : ''} onClick={() => setView('completed')}>History</button>
      </div>

      {error && <p className="orders-error">{error}</p>}

      {!visibleOrders.length ? (
        <section className="orders-empty">
          <span>{view === 'active' ? '🍽️' : '🧾'}</span>
          <h2>{view === 'active' ? 'No active orders' : 'No order history yet'}</h2>
          <p>{view === 'active' ? 'Paid customer orders will appear here in real time.' : 'Completed, rejected and cancelled orders will appear here.'}</p>
        </section>
      ) : (
        <section className="orders-list">
          {visibleOrders.map((order) => (
            <article className={`order-card status-${order.order_status}`} key={order.id}>
              <div className="order-card-header">
                <div>
                  <span className="order-number">Order #{order.order_number}</span>
                  <strong>{order.customer_first_name} {order.customer_last_name}</strong>
                  <small>{time.format(new Date(order.created_at))} · {order.fulfilment_method}</small>
                </div>
                <div className="order-card-total">
                  <span className={`order-status ${order.order_status}`}>{statusLabels[order.order_status] ?? order.order_status}</span>
                  <strong>{money.format(order.total_pence / 100)}</strong>
                </div>
              </div>

              <div className="order-items">
                {order.order_items.map((item) => (
                  <div key={item.id}>
                    <span><b>{item.quantity}×</b> {item.item_name}{item.customer_notes ? <small>{item.customer_notes}</small> : null}</span>
                    <strong>{money.format((item.unit_price_pence * item.quantity) / 100)}</strong>
                  </div>
                ))}
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
