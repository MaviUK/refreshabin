import { useEffect, useState } from 'react'
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
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function CustomerOrders() {
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
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

        <div className="customer-order-list">
          {orders.map((order) => (
            <article className="customer-order-card" key={order.id}>
              <div className="customer-order-topline">
                <div>
                  <span>Order #{order.order_number}</span>
                  <h2>{order.restaurant_name}</h2>
                </div>
                <strong>{money.format(order.total_pence / 100)}</strong>
              </div>
              <div className="customer-order-meta">
                <span>{dateTime.format(new Date(order.created_at))}</span>
                <span>{formatStatus(order.fulfilment_method)}</span>
                <span>{formatStatus(order.order_status)}</span>
              </div>
              <div className="customer-order-actions">
                {order.stripe_checkout_session_id && (
                  <Link to={`/order/success?session_id=${encodeURIComponent(order.stripe_checkout_session_id)}`}>View order</Link>
                )}
                <Link to={`/r/${order.restaurant_slug}`}>Order again</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
