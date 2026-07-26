import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './PrintHistory.css'

type PrintJobStatus = 'queued' | 'processing' | 'printed' | 'failed' | 'cancelled'
type PrintJob = {
  id: string
  order_id: string
  printer_id: string | null
  document_type: 'kitchen_ticket' | 'customer_receipt'
  status: PrintJobStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  queued_at: string
  processing_at: string | null
  printed_at: string | null
  failed_at: string | null
  created_at: string
  orders: { order_number: number } | { order_number: number }[] | null
  restaurant_printers: { name: string } | { name: string }[] | null
}

type Membership = {
  restaurant_id: string
  restaurants: { name: string } | { name: string }[] | null
}

const statusLabels: Record<PrintJobStatus, string> = {
  queued: 'Queued',
  processing: 'Printing',
  printed: 'Printed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function joinedName(value: PrintJob['restaurant_printers']) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Unassigned printer'
  return value?.name ?? 'Unassigned printer'
}

function orderNumber(value: PrintJob['orders']) {
  const order = Array.isArray(value) ? value[0] : value
  return order?.order_number ? `#${order.order_number}` : 'Unknown order'
}

function restaurantName(value: Membership['restaurants']) {
  if (Array.isArray(value)) return value[0]?.name ?? 'Restaurant'
  return value?.name ?? 'Restaurant'
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function PrintHistory() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState('')
  const [restaurant, setRestaurant] = useState('Restaurant')
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [filter, setFilter] = useState<'all' | PrintJobStatus>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [actionId, setActionId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadJobs = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setRefreshing(true)
    const { data, error: jobsError } = await supabase
      .from('print_jobs')
      .select(`
        id,
        order_id,
        printer_id,
        document_type,
        status,
        attempts,
        max_attempts,
        last_error,
        queued_at,
        processing_at,
        printed_at,
        failed_at,
        created_at,
        orders(order_number),
        restaurant_printers(name)
      `)
      .eq('restaurant_id', id)
      .order('created_at', { ascending: false })
      .limit(100)

    setRefreshing(false)
    if (jobsError) throw jobsError
    setJobs((data ?? []) as PrintJob[])
  }, [])

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function initialise() {
      try {
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
        const typed = membership as Membership
        setRestaurantId(typed.restaurant_id)
        setRestaurant(restaurantName(typed.restaurants))
        await loadJobs(typed.restaurant_id, true)

        channel = supabase
          .channel(`print-history:${typed.restaurant_id}`)
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'print_jobs',
            filter: `restaurant_id=eq.${typed.restaurant_id}`,
          }, () => void loadJobs(typed.restaurant_id, true))
          .subscribe()
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to load print history.')
      } finally {
        setLoading(false)
      }
    }

    void initialise()
    return () => {
      if (channel) void supabase.removeChannel(channel)
    }
  }, [loadJobs, navigate])

  const visibleJobs = useMemo(
    () => filter === 'all' ? jobs : jobs.filter((job) => job.status === filter),
    [filter, jobs],
  )

  const counts = useMemo(() => ({
    all: jobs.length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    queued: jobs.filter((job) => job.status === 'queued').length,
    processing: jobs.filter((job) => job.status === 'processing').length,
    printed: jobs.filter((job) => job.status === 'printed').length,
  }), [jobs])

  async function requeue(job: PrintJob) {
    if (actionId || !job.printer_id) return
    const verb = job.status === 'printed' ? 'Reprint' : 'Retry'
    if (job.status === 'printed' && !window.confirm(`Reprint order ${orderNumber(job.orders)}?`)) return

    setActionId(job.id)
    setError('')
    setMessage('')
    const { error: retryError } = await supabase.rpc('retry_print_job', { p_job_id: job.id })
    setActionId('')

    if (retryError) {
      setError(retryError.message)
      return
    }

    setMessage(`${verb} queued for order ${orderNumber(job.orders)}.`)
    if (restaurantId) await loadJobs(restaurantId, true)
  }

  if (loading) return <main className="portal-shell"><div className="menu-state-card">Loading print history…</div></main>

  return (
    <main className="portal-shell print-history-page">
      <header className="portal-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurant} · Print history</p>
        </div>
        <div className="print-history-header-actions">
          <Link className="secondary-button button-link" to="/printers">Printers</Link>
          <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
        </div>
      </header>

      <section className="page-heading-row">
        <div>
          <span className="eyebrow">Kitchen operations</span>
          <h1>Print history</h1>
          <p>Review recent tickets, retry failed jobs, and reprint completed orders.</p>
        </div>
        <button className="secondary-button" type="button" disabled={refreshing} onClick={() => restaurantId && void loadJobs(restaurantId)}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="form-success" role="status">{message}</div>}

      <section className="print-history-summary" aria-label="Print job summary">
        <article><span>Failed</span><strong>{counts.failed}</strong></article>
        <article><span>Queued</span><strong>{counts.queued}</strong></article>
        <article><span>Printing</span><strong>{counts.processing}</strong></article>
        <article><span>Printed</span><strong>{counts.printed}</strong></article>
      </section>

      <div className="print-history-filters" role="group" aria-label="Filter print jobs">
        {(['all', 'failed', 'queued', 'processing', 'printed'] as const).map((status) => (
          <button key={status} type="button" className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>
            {status === 'all' ? 'All' : statusLabels[status]} <span>{status === 'all' ? counts.all : counts[status]}</span>
          </button>
        ))}
      </div>

      <section className="print-history-list">
        {visibleJobs.length === 0 ? (
          <div className="settings-card print-history-empty">
            <h2>No print jobs found</h2>
            <p>{filter === 'all' ? 'Print jobs will appear here when paid orders are queued.' : `There are no ${filter} print jobs.`}</p>
          </div>
        ) : visibleJobs.map((job) => (
          <article className="settings-card print-job-card" key={job.id}>
            <div className="print-job-main">
              <div>
                <span className={`print-job-status ${job.status}`}>{statusLabels[job.status]}</span>
                <h2>Order {orderNumber(job.orders)}</h2>
                <p>{job.document_type === 'kitchen_ticket' ? 'Kitchen ticket' : 'Customer receipt'} · {joinedName(job.restaurant_printers)}</p>
              </div>
              <div className="print-job-time">
                <span>{job.status === 'printed' ? 'Printed' : job.status === 'failed' ? 'Failed' : 'Queued'}</span>
                <strong>{formatDate(job.printed_at ?? job.failed_at ?? job.queued_at)}</strong>
              </div>
            </div>

            <div className="print-job-meta">
              <span>Attempts {job.attempts}/{job.max_attempts}</span>
              <span>Created {formatDate(job.created_at)}</span>
            </div>

            {job.last_error && (
              <div className="print-job-error" role="alert">
                <strong>Last error</strong>
                <p>{job.last_error}</p>
              </div>
            )}

            <div className="print-job-actions">
              <Link className="secondary-button button-link" to="/orders">View orders</Link>
              {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'printed') && (
                <button
                  className="primary-button"
                  type="button"
                  disabled={actionId !== '' || !job.printer_id}
                  title={!job.printer_id ? 'Assign a printer before retrying this job.' : undefined}
                  onClick={() => void requeue(job)}
                >
                  {actionId === job.id ? 'Queuing…' : job.status === 'printed' ? 'Reprint' : 'Retry print'}
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
