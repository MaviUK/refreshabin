import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney } from '../types'

type OrderStatus =
  | 'pending_payment'
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled'
  | 'rejected'

type PaymentStatus = 'pending' | 'requires_action' | 'paid' | 'failed' | 'refunded' | 'partially_refunded'
type FulfilmentMethod = 'delivery' | 'collection'
type ScheduleFilter = 'asap' | 'scheduled'

type OrderListEntry = {
  id: string
  order_number: number
  restaurant_id: string
  restaurant_name: string
  restaurant_slug: string
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  fulfilment_method: FulfilmentMethod
  order_status: OrderStatus
  payment_status: PaymentStatus
  subtotal_pence: number
  delivery_fee_pence: number
  discount_pence: number
  total_pence: number
  currency: string
  requested_fulfilment_at: string | null
  estimated_ready_at: string | null
  paid_at: string | null
  accepted_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  rejection_reason: string | null
  item_count: number
  needs_attention: boolean
  response_wait_minutes: number | null
}

type OrderSummary = {
  awaiting_acceptance: number
  needs_attention: number
  scheduled_upcoming: number
  paid_today: number
  gross_today_pence: number
}

type OrderPagination = {
  page: number
  page_size: number
  total: number
  total_pages: number
}

type OrderSnapshot = {
  orders: OrderListEntry[]
  summary: OrderSummary
  pagination: OrderPagination
}

type OrderItem = {
  id: string
  item_name: string
  unit_price_pence: number
  quantity: number
  line_total_pence: number
  customer_notes: string | null
  item_snapshot: Record<string, unknown>
}

type OrderHistoryEntry = {
  id: number
  from_status: string | null
  to_status: string
  note: string | null
  created_at: string
  actor_name: string
}

type OrderDetail = {
  order: OrderListEntry & {
    restaurant_notes: string | null
    receipt_sent_at: string | null
    receipt_error: string | null
    restaurant_notified_at: string | null
    stripe_checkout_session_id: string | null
    stripe_payment_intent_id: string | null
  }
  customer: {
    user_id: string | null
    first_name: string
    last_name: string
    email: string
    phone: string
  } | null
  delivery: {
    address_line_1: string | null
    address_line_2: string | null
    town_city: string | null
    postcode: string | null
    instructions: string | null
  } | null
  items: OrderItem[]
  history: OrderHistoryEntry[]
}

const orderStatuses: Array<{ value: OrderStatus; label: string }> = [
  { value: 'pending_payment', label: 'Pending payment' },
  { value: 'placed', label: 'Awaiting acceptance' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rejected', label: 'Rejected' },
]

const paymentStatuses: Array<{ value: PaymentStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'requires_action', label: 'Requires action' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partially refunded' },
]

const emptySnapshot: OrderSnapshot = {
  orders: [],
  summary: { awaiting_acceptance: 0, needs_attention: 0, scheduled_upcoming: 0, paid_today: 0, gross_today_pence: 0 },
  pagination: { page: 1, page_size: 50, total: 0, total_pages: 1 },
}

export default function Orders() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [status, setStatus] = useState<OrderStatus | ''>(validOrderStatus(params.get('status')))
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>(validPaymentStatus(params.get('payment')))
  const [fulfilment, setFulfilment] = useState<FulfilmentMethod | ''>(params.get('fulfilment') === 'delivery' || params.get('fulfilment') === 'collection' ? params.get('fulfilment') as FulfilmentMethod : '')
  const [schedule, setSchedule] = useState<ScheduleFilter | ''>(params.get('schedule') === 'scheduled' || params.get('schedule') === 'asap' ? params.get('schedule') as ScheduleFilter : '')
  const [attentionOnly, setAttentionOnly] = useState(params.get('attention') === '1')
  const [page, setPage] = useState(Math.max(Number(params.get('page')) || 1, 1))
  const [selectedId, setSelectedId] = useState(params.get('order'))
  const [snapshot, setSnapshot] = useState<OrderSnapshot>(emptySnapshot)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    setParams(next, { replace: true })
  }, [params, setParams])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_orders', {
      p_status: status || null,
      p_payment_status: paymentStatus || null,
      p_fulfilment_method: fulfilment || null,
      p_schedule: schedule || null,
      p_attention_only: attentionOnly,
      p_search: search.trim() || null,
      p_page: page,
      p_page_size: 50,
    })

    if (loadError) {
      setError(loadError.message)
      setSnapshot(emptySnapshot)
    } else {
      const next = data as OrderSnapshot
      setSnapshot(next)
      setSelectedId((current) => next.orders.some((order) => order.id === current) ? current : next.orders[0]?.id ?? null)
      setLastUpdated(new Date())
    }
    setLoading(false)
  }, [attentionOnly, fulfilment, page, paymentStatus, schedule, search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }

    let active = true
    setDetailLoading(true)
    void supabase.rpc('get_platform_order', { p_order_id: selectedId }).then(({ data, error: detailError }) => {
      if (!active) return
      if (detailError) {
        setError(detailError.message)
        setDetail(null)
      } else {
        setDetail(data as OrderDetail)
      }
      setDetailLoading(false)
    })

    return () => { active = false }
  }, [selectedId])

  const selected = useMemo(() => snapshot.orders.find((order) => order.id === selectedId) ?? null, [selectedId, snapshot.orders])

  function resetPage(updates: Record<string, string | null>, change: () => void) {
    setPage(1)
    change()
    updateUrl({ ...updates, page: null, order: null })
  }

  function selectOrder(id: string) {
    setSelectedId(id)
    setError('')
    updateUrl({ order: id })
  }

  function clearFilters() {
    setSearch('')
    setStatus('')
    setPaymentStatus('')
    setFulfilment('')
    setSchedule('')
    setAttentionOnly(false)
    setPage(1)
    setSelectedId(null)
    setParams({}, { replace: true })
  }

  function changePage(nextPage: number) {
    setPage(nextPage)
    setSelectedId(null)
    updateUrl({ page: nextPage === 1 ? null : String(nextPage), order: null })
  }

  return (
    <div className="admin-page orders-page">
      <header className="page-heading">
        <div><span className="admin-kicker">Live order operations</span><h1>Orders</h1><p>Monitor every order, spot slow responses and inspect the full customer-to-restaurant timeline.</p></div>
        <div className="order-refresh"><small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Not updated yet'}</small><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>↻ Refresh</button></div>
      </header>

      {error && <div className="admin-alert error" role="alert">{error}</div>}

      <section className="order-metric-grid" aria-label="Order operations summary">
        <OrderMetric label="Awaiting acceptance" value={snapshot.summary.awaiting_acceptance} detail="Paid orders" tone="amber" />
        <OrderMetric label="Needs attention" value={snapshot.summary.needs_attention} detail="Waiting over 5 minutes" tone="red" />
        <OrderMetric label="Scheduled ahead" value={snapshot.summary.scheduled_upcoming} detail="Upcoming orders" tone="blue" />
        <OrderMetric label="Paid today" value={snapshot.summary.paid_today} detail={formatMoney(snapshot.summary.gross_today_pence)} tone="green" />
      </section>

      <section className="order-toolbar" aria-label="Order filters">
        <label className="admin-search order-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => resetPage({ search: event.target.value || null }, () => setSearch(event.target.value))} placeholder="Order number, customer or restaurant…" /></label>
        <label>Status<select value={status} onChange={(event) => resetPage({ status: event.target.value || null }, () => setStatus(event.target.value as OrderStatus | ''))}><option value="">All statuses</option>{orderStatuses.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label>
        <label>Payment<select value={paymentStatus} onChange={(event) => resetPage({ payment: event.target.value || null }, () => setPaymentStatus(event.target.value as PaymentStatus | ''))}><option value="">All payments</option>{paymentStatuses.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></label>
        <label>Method<select value={fulfilment} onChange={(event) => resetPage({ fulfilment: event.target.value || null }, () => setFulfilment(event.target.value as FulfilmentMethod | ''))}><option value="">Delivery & collection</option><option value="delivery">Delivery</option><option value="collection">Collection</option></select></label>
        <label>Timing<select value={schedule} onChange={(event) => resetPage({ schedule: event.target.value || null }, () => setSchedule(event.target.value as ScheduleFilter | ''))}><option value="">ASAP & scheduled</option><option value="asap">ASAP</option><option value="scheduled">Scheduled</option></select></label>
        <button type="button" className={`attention-filter ${attentionOnly ? 'active' : ''}`} onClick={() => resetPage({ attention: attentionOnly ? null : '1' }, () => setAttentionOnly((current) => !current))}><span>!</span> Needs attention</button>
        <button type="button" className="clear-filter-button" onClick={clearFilters}>Clear</button>
      </section>

      <div className="order-workspace">
        <section className="order-list" aria-label="Platform orders">
          <div className="list-heading"><strong>{loading ? 'Loading…' : `${snapshot.pagination.total} order${snapshot.pagination.total === 1 ? '' : 's'}`}</strong><small>Attention first · newest next</small></div>
          {!loading && snapshot.orders.length === 0 && <div className="panel-empty"><strong>No orders found</strong><span>Try clearing one or more filters.</span></div>}
          {snapshot.orders.map((order) => (
            <button type="button" className={`order-list-row ${order.id === selectedId ? 'active' : ''} ${order.needs_attention ? 'attention' : ''}`} onClick={() => selectOrder(order.id)} key={order.id}>
              <div className="order-row-heading"><strong>#{order.order_number}</strong><span className={`order-status-badge ${order.order_status}`}>{orderStatusLabel(order.order_status)}</span>{order.needs_attention && <span className="order-attention-badge">! {formatWait(order.response_wait_minutes)}</span>}</div>
              <div className="order-row-body"><span><strong>{order.restaurant_name}</strong><small>{order.customer_name || 'Customer details restricted'}</small></span><span><strong>{formatMoney(order.total_pence)}</strong><small>{capitalise(order.fulfilment_method)} · {order.item_count} item{order.item_count === 1 ? '' : 's'}</small></span></div>
              <div className="order-row-time"><span>{order.requested_fulfilment_at ? `Requested ${formatDate(order.requested_fulfilment_at)}` : `Placed ${formatDate(order.created_at)}`}</span><span className={`payment-badge ${order.payment_status}`}>{paymentStatusLabel(order.payment_status)}</span></div>
            </button>
          ))}
          {snapshot.pagination.total_pages > 1 && <div className="order-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}>‹ Previous</button><span>Page {snapshot.pagination.page} of {snapshot.pagination.total_pages}</span><button type="button" disabled={page >= snapshot.pagination.total_pages || loading} onClick={() => changePage(page + 1)}>Next ›</button></div>}
        </section>

        <section className="order-detail">
          {!selected && !detailLoading && <div className="panel-empty"><strong>Select an order</strong><span>Customer, payment, items and status history will appear here.</span></div>}
          {detailLoading && <div className="panel-empty"><div className="gate-spinner" /><span>Loading order details…</span></div>}
          {!detailLoading && detail && <OrderDetailView detail={detail} />}
        </section>
      </div>
    </div>
  )
}

function OrderDetailView({ detail }: { detail: OrderDetail }) {
  const { order, customer, delivery, items, history } = detail
  return <>
    <div className="order-detail-header">
      <div><span className="admin-kicker">Order #{order.order_number}</span><h2>{order.restaurant_name}</h2><div className="order-detail-badges"><span className={`order-status-badge ${order.order_status}`}>{orderStatusLabel(order.order_status)}</span><span className={`payment-badge ${order.payment_status}`}>{paymentStatusLabel(order.payment_status)}</span><span className="fulfilment-badge">{capitalise(order.fulfilment_method)}</span>{order.requested_fulfilment_at && <span className="scheduled-badge">Scheduled</span>}</div></div>
      <a className="secondary-button" href={`/r/${order.restaurant_slug}`} target="_blank" rel="noreferrer">Storefront ↗</a>
    </div>

    {order.needs_attention && <div className="order-attention-banner"><span>!</span><div><strong>Restaurant response overdue</strong><p>This paid order has waited {formatWait(order.response_wait_minutes)} without being accepted or rejected.</p></div></div>}

    <div className="order-detail-summary">
      <DetailStat label="Order total" value={formatMoney(order.total_pence)} detail={paymentStatusLabel(order.payment_status)} />
      <DetailStat label="Placed" value={formatDate(order.created_at)} detail={order.paid_at ? `Paid ${formatDate(order.paid_at)}` : 'Payment not completed'} />
      <DetailStat label="Requested for" value={order.requested_fulfilment_at ? formatDate(order.requested_fulfilment_at) : 'As soon as possible'} detail={order.estimated_ready_at ? `Estimated ${formatDate(order.estimated_ready_at)}` : 'No ready estimate'} />
    </div>

    <div className="order-detail-columns">
      <section className="order-detail-section">
        <h3>Customer & fulfilment</h3>
        {customer ? <div className="order-contact-card"><strong>{customer.first_name} {customer.last_name}</strong><a href={`mailto:${customer.email}`}>{customer.email}</a><a href={`tel:${customer.phone}`}>{customer.phone}</a>{delivery && <address>{[delivery.address_line_1, delivery.address_line_2, delivery.town_city, delivery.postcode].filter(Boolean).join(', ')}</address>}{delivery?.instructions && <p><span>Instructions</span>{delivery.instructions}</p>}</div> : <div className="restricted-detail"><strong>Customer details restricted</strong><span>This administrator role can inspect the order and payment record without personal contact or address data.</span></div>}
      </section>
      <section className="order-detail-section">
        <h3>Operational record</h3>
        <div className="operation-grid"><Operation label="Restaurant notified" value={formatDate(order.restaurant_notified_at)} /><Operation label="Receipt sent" value={formatDate(order.receipt_sent_at)} /><Operation label="Accepted" value={formatDate(order.accepted_at)} /><Operation label="Completed" value={formatDate(order.completed_at)} /></div>
        {order.rejection_reason && <div className="order-note danger"><strong>Rejection reason</strong><span>{order.rejection_reason}</span></div>}
        {order.restaurant_notes && <div className="order-note"><strong>Restaurant note</strong><span>{order.restaurant_notes}</span></div>}
        {order.receipt_error && <div className="order-note danger"><strong>Receipt delivery error</strong><span>{order.receipt_error}</span></div>}
      </section>
    </div>

    <section className="order-detail-section order-items-section">
      <h3>Items</h3>
      <div className="admin-order-items">
        {items.map((item) => {
          const choices = itemChoices(item.item_snapshot)
          return <article key={item.id}><span className="item-quantity">{item.quantity}×</span><div><strong>{item.item_name}</strong>{choices.length > 0 && <small>{choices.join(' · ')}</small>}{item.customer_notes && <p>Note: {item.customer_notes}</p>}</div><strong>{formatMoney(item.line_total_pence)}</strong></article>
        })}
      </div>
      <div className="order-totals"><span>Subtotal<strong>{formatMoney(order.subtotal_pence)}</strong></span><span>Delivery<strong>{formatMoney(order.delivery_fee_pence)}</strong></span>{order.discount_pence > 0 && <span>Discount<strong>−{formatMoney(order.discount_pence)}</strong></span>}<span className="total">Total<strong>{formatMoney(order.total_pence)}</strong></span></div>
    </section>

    <section className="order-detail-section">
      <h3>Status history</h3>
      <div className="order-timeline">
        {history.length === 0 && <div className="restricted-detail"><span>No status changes have been recorded.</span></div>}
        {history.map((entry) => <article key={entry.id}><span className="timeline-dot" /><div><strong>{orderStatusLabel(entry.to_status as OrderStatus)}</strong><small>{entry.actor_name}{entry.from_status ? ` · from ${orderStatusLabel(entry.from_status as OrderStatus)}` : ''}</small>{entry.note && <p>{entry.note}</p>}</div><time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time></article>)}
      </div>
    </section>

    {(order.stripe_payment_intent_id || order.stripe_checkout_session_id) && <section className="order-detail-section"><h3>Payment references</h3><div className="payment-references">{order.stripe_payment_intent_id && <code>{order.stripe_payment_intent_id}</code>}{order.stripe_checkout_session_id && <code>{order.stripe_checkout_session_id}</code>}</div></section>}
  </>
}

function OrderMetric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: string }) {
  return <article className="order-metric"><span className={`metric-dot ${tone}`} /><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>
}

function DetailStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>
}

function Operation({ label, value }: { label: string; value: string }) {
  return <article><small>{label}</small><strong>{value}</strong></article>
}

function validOrderStatus(value: string | null): OrderStatus | '' {
  return orderStatuses.some((entry) => entry.value === value) ? value as OrderStatus : ''
}

function validPaymentStatus(value: string | null): PaymentStatus | '' {
  return paymentStatuses.some((entry) => entry.value === value) ? value as PaymentStatus : ''
}

function orderStatusLabel(status: OrderStatus) {
  return orderStatuses.find((entry) => entry.value === status)?.label ?? capitalise(status.replaceAll('_', ' '))
}

function paymentStatusLabel(status: PaymentStatus) {
  return paymentStatuses.find((entry) => entry.value === status)?.label ?? capitalise(status.replaceAll('_', ' '))
}

function formatWait(minutes: number | null) {
  if (minutes === null) return 'No wait recorded'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function itemChoices(snapshot: Record<string, unknown>) {
  const choices: string[] = []
  const groups = Array.isArray(snapshot.modifier_groups) ? snapshot.modifier_groups : []
  groups.forEach((group) => {
    if (!isRecord(group) || !Array.isArray(group.options)) return
    group.options.forEach((option) => {
      if (isRecord(option) && typeof option.name === 'string') choices.push(option.name)
    })
  })
  const extras = Array.isArray(snapshot.selected_extras) ? snapshot.selected_extras : []
  extras.forEach((extra) => {
    if (isRecord(extra) && typeof extra.name === 'string') choices.push(`Extra ${extra.name}`)
  })
  const removed = Array.isArray(snapshot.removed_ingredients) ? snapshot.removed_ingredients : []
  removed.forEach((ingredient) => {
    if (typeof ingredient === 'string') choices.push(`No ${ingredient}`)
    else if (isRecord(ingredient) && typeof ingredient.name === 'string') choices.push(`No ${ingredient.name}`)
  })
  return choices
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
