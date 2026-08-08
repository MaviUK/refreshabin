import { useState, type FormEvent } from 'react'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney, hasAdminPermission } from '../types'

type RecoverySnapshot = {
  order: {
    id: string
    order_number: number
    restaurant_name: string
    customer_name: string
    order_status: string
    payment_status: string
    total_pence: number
    fulfilment_method: string
    created_at: string
    cancelled_at: string | null
  }
  print_jobs: Array<{
    id: string
    printer_name: string
    document_type: string
    status: string
    attempts: number
    last_error: string | null
    queued_at: string
    printed_at: string | null
  }>
  actions: Array<{
    id: number
    action: string
    reason: string
    created_at: string
    actor_name: string
  }>
}

export default function OrderRecovery() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'orders:manage')
  const [orderNumber, setOrderNumber] = useState('')
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function search(event?: FormEvent) {
    event?.preventDefault()
    const parsed = Number.parseInt(orderNumber, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Enter a valid order number.')
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    const { data, error: loadError } = await supabase.rpc('get_platform_order_recovery', { p_order_number: parsed })
    if (loadError) {
      setSnapshot(null)
      setError(loadError.message)
    } else {
      setSnapshot(data as RecoverySnapshot)
      setReason('')
    }
    setLoading(false)
  }

  async function recover(action: 'cancel' | 'requeue_print') {
    if (!snapshot || !canManage || saving) return
    if (reason.trim().length < 3) {
      setError('Add a clear reason of at least 3 characters.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    const { error: actionError } = await supabase.rpc('recover_platform_order', {
      p_order_id: snapshot.order.id,
      p_action: action,
      p_reason: reason.trim(),
    })
    if (actionError) {
      setError(actionError.message)
    } else {
      setMessage(action === 'cancel' ? 'Order cancelled and recorded in its status history.' : 'Print jobs requeued successfully.')
      await search()
    }
    setSaving(false)
  }

  const terminal = snapshot ? ['completed', 'cancelled', 'rejected'].includes(snapshot.order.order_status) : false

  return <div className="admin-page">
    <header className="page-heading"><div><span className="admin-kicker">Operational recovery</span><h1>Order recovery</h1><p>Find an order, cancel it when operationally necessary, or resend its kitchen print jobs.</p></div></header>

    <form className="restaurant-toolbar" onSubmit={(event) => void search(event)}>
      <label className="admin-search"><span aria-hidden="true">#</span><input type="number" min="1" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="Enter order number…" /></label>
      <button type="submit" className="admin-primary-button" disabled={loading}>{loading ? 'Searching…' : 'Find order'}</button>
    </form>

    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {message && <div className="admin-alert success" role="status">{message}</div>}

    {!snapshot && !loading && <div className="panel-empty"><strong>No order selected</strong><span>Search using the customer-facing order number.</span></div>}

    {snapshot && <div className="order-detail">
      <div className="order-detail-header"><div><span className="admin-kicker">Order #{snapshot.order.order_number}</span><h2>{snapshot.order.restaurant_name}</h2><div className="order-detail-badges"><span className={`order-status-badge ${snapshot.order.order_status}`}>{snapshot.order.order_status.replaceAll('_', ' ')}</span><span className={`payment-badge ${snapshot.order.payment_status}`}>{snapshot.order.payment_status.replaceAll('_', ' ')}</span></div></div></div>

      <div className="order-detail-summary">
        <article><small>Total</small><strong>{formatMoney(snapshot.order.total_pence)}</strong><span>{snapshot.order.fulfilment_method}</span></article>
        <article><small>Customer</small><strong>{snapshot.order.customer_name || 'Guest customer'}</strong><span>Placed {formatDate(snapshot.order.created_at)}</span></article>
        <article><small>Print jobs</small><strong>{snapshot.print_jobs.length}</strong><span>{snapshot.print_jobs.filter((job) => job.status === 'failed').length} failed</span></article>
      </div>

      <section className="order-detail-section">
        <h3>Recovery controls</h3>
        {!canManage && <div className="read-only-notice"><strong>Read-only access</strong><span>Your role can inspect recovery history but cannot perform actions.</span></div>}
        {canManage && <>
          <label>Reason for action<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the audit trail…" /></label>
          <div className="restaurant-actions">
            <button type="button" className="danger-button ghost" disabled={saving || terminal} onClick={() => void recover('cancel')}>{terminal ? 'Order cannot be cancelled' : 'Cancel order'}</button>
            <button type="button" className="admin-primary-button" disabled={saving} onClick={() => void recover('requeue_print')}>{saving ? 'Working…' : 'Requeue all print jobs'}</button>
          </div>
        </>}
      </section>

      <section className="order-detail-section"><h3>Printer record</h3>
        {snapshot.print_jobs.length === 0 ? <div className="restricted-detail"><span>No print jobs have been created yet.</span></div> : <div className="order-timeline">{snapshot.print_jobs.map((job) => <article key={job.id}><span className="timeline-dot" /><div><strong>{job.printer_name}</strong><small>{job.document_type.replaceAll('_', ' ')} · {job.status} · {job.attempts} attempts</small>{job.last_error && <p>{job.last_error}</p>}</div><time>{job.printed_at ? formatDate(job.printed_at) : formatDate(job.queued_at)}</time></article>)}</div>}
      </section>

      <section className="order-detail-section"><h3>Recovery history</h3>
        {snapshot.actions.length === 0 ? <div className="restricted-detail"><span>No platform recovery actions recorded.</span></div> : <div className="order-timeline">{snapshot.actions.map((action) => <article key={action.id}><span className="timeline-dot" /><div><strong>{action.action.replaceAll('_', ' ')}</strong><small>{action.actor_name}</small><p>{action.reason}</p></div><time>{formatDate(action.created_at)}</time></article>)}</div>}
      </section>
    </div>}
  </div>
}
