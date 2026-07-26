import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './OrderStatus.css'

type OrderItem = {
  id: string
  item_name: string
  quantity: number
  unit_price_pence: number
  line_total_pence: number | null
  customer_notes: string | null
  item_snapshot: {
    removed_ingredients?: { id: string; name: string }[]
    selected_extras?: { id: string; name: string; price_pence: number; quantity: number }[]
    modifier_groups?: { group_id: string; group_name: string; options: { id: string; name: string; price_pence: number; quantity: number }[] }[]
  }
}

type OrderStatusData = {
  order: {
    id: string
    order_number: number
    customer_first_name: string
    fulfilment_method: 'delivery' | 'collection'
    address_line_1: string | null
    address_line_2: string | null
    town_city: string | null
    postcode: string | null
    subtotal_pence: number
    delivery_fee_pence: number
    discount_pence: number
    total_pence: number
    payment_status: string
    order_status: string
    estimated_ready_at: string | null
    created_at: string
  }
  restaurant: { name: string; slug: string; logo_url: string | null; preparation_time_minutes: number }
  items: OrderItem[]
}

type FunctionResponse = OrderStatusData & { error?: string }

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

const statusSteps = [
  { key: 'confirmed', label: 'Order received' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'completed', label: 'Delivered' },
]

function normaliseStatus(status: string, method: 'delivery' | 'collection') {
  if (status === 'pending_payment') return 'confirmed'
  if (status === 'accepted') return 'confirmed'
  if (status === 'ready_for_collection') return 'ready'
  if (status === 'collected') return 'completed'
  if (method === 'collection' && status === 'out_for_delivery') return 'ready'
  return status
}

export default function OrderStatus() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') ?? ''
  const orderId = searchParams.get('order_id') ?? ''
  const [data, setData] = useState<OrderStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId || !orderId) {
      setError('This order link is incomplete.')
      setLoading(false)
      return
    }

    let stopped = false
    async function load() {
      const { data: response, error: functionError } = await supabase.functions.invoke<FunctionResponse>('get-order-status', {
        body: { session_id: sessionId, order_id: orderId },
      })
      if (stopped) return
      if (functionError || !response || response.error) {
        setError(response?.error || functionError?.message || 'Unable to load your order.')
      } else {
        setData(response)
        setError('')
        if (response.order.payment_status === 'paid') {
          window.localStorage.removeItem(`ordered-food-basket:${response.restaurant.slug}`)
          window.localStorage.removeItem(`ordered-food-pending-order:${response.restaurant.slug}`)
        }
      }
      setLoading(false)
    }

    void load()
    const timer = window.setInterval(() => void load(), 10000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [sessionId, orderId])

  if (loading) return <main className="order-status-state">Confirming your payment…</main>
  if (error || !data) return <main className="order-status-state"><h1>Unable to load order</h1><p>{error}</p><Link to="/">Return home</Link></main>

  const { order, restaurant, items } = data
  const currentStatus = normaliseStatus(order.order_status, order.fulfilment_method)
  const visibleSteps = order.fulfilment_method === 'collection'
    ? statusSteps.filter((step) => step.key !== 'out_for_delivery').map((step) => step.key === 'completed' ? { ...step, label: 'Collected' } : step)
    : statusSteps
  const currentIndex = Math.max(0, visibleSteps.findIndex((step) => step.key === currentStatus))
  const estimated = order.estimated_ready_at
    ? new Date(order.estimated_ready_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : `${restaurant.preparation_time_minutes}–${restaurant.preparation_time_minutes + 10} minutes`

  return (
    <main className="order-status-page">
      <header className="order-status-header"><Link to="/">ordered.food</Link><span>Order #{order.order_number}</span></header>
      <section className="order-status-hero">
        <div className="payment-tick">✓</div>
        <span>{order.payment_status === 'paid' ? 'Payment successful' : 'Payment processing'}</span>
        <h1>Thanks, {order.customer_first_name}</h1>
        <p>{restaurant.name} has received your order.</p>
        <strong>Estimated {order.fulfilment_method === 'delivery' ? 'delivery' : 'collection'}: {estimated}</strong>
      </section>

      <section className="order-status-card">
        <h2>Order status</h2>
        <div className="order-timeline">
          {visibleSteps.map((step, index) => <div className={index <= currentIndex ? 'active' : ''} key={step.key}><span>{index < currentIndex ? '✓' : index + 1}</span><strong>{step.label}</strong></div>)}
        </div>
      </section>

      <section className="order-status-card">
        <div className="order-copy-heading"><div><span>Your order from</span><h2>{restaurant.name}</h2></div><strong>#{order.order_number}</strong></div>
        <div className="order-copy-items">
          {items.map((item) => <div key={item.id}><div><strong>{item.quantity} × {item.item_name}</strong>
            {item.item_snapshot?.removed_ingredients?.map((ingredient) => <small key={ingredient.id}>No {ingredient.name}</small>)}
            {item.item_snapshot?.selected_extras?.map((extra) => <small key={extra.id}>+ {extra.quantity > 1 ? `${extra.quantity} × ` : ''}{extra.name}</small>)}
            {item.item_snapshot?.modifier_groups?.flatMap((group) => group.options.map((option) => <small key={`${group.group_id}-${option.id}`}>{group.group_name}: {option.quantity > 1 ? `${option.quantity} × ` : ''}{option.name}</small>))}
            {item.customer_notes && <small>Note: {item.customer_notes}</small>}
          </div><strong>{money.format(((item.line_total_pence ?? item.unit_price_pence * item.quantity) || 0) / 100)}</strong></div>)}
        </div>
        <div className="order-copy-costs"><div><span>Subtotal</span><strong>{money.format(order.subtotal_pence / 100)}</strong></div>{order.delivery_fee_pence > 0 && <div><span>Delivery</span><strong>{money.format(order.delivery_fee_pence / 100)}</strong></div>}{order.discount_pence > 0 && <div><span>Discount</span><strong>−{money.format(order.discount_pence / 100)}</strong></div>}<div className="order-copy-total"><span>Total paid</span><strong>{money.format(order.total_pence / 100)}</strong></div></div>
      </section>

      <section className="order-status-card">
        <h2>{order.fulfilment_method === 'delivery' ? 'Delivery details' : 'Collection'}</h2>
        {order.fulfilment_method === 'delivery' ? <p>{[order.address_line_1, order.address_line_2, order.town_city, order.postcode].filter(Boolean).join(', ')}</p> : <p>Collect your order from {restaurant.name} when it is marked ready.</p>}
        <p className="receipt-note">A receipt will be emailed to you with a PDF copy attached.</p>
      </section>
    </main>
  )
}
