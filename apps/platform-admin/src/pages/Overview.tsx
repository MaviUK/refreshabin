import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney } from '../types'
import { useAdmin } from '../components/AdminLayout'

type OverviewData = {
  pending_restaurants: number
  active_restaurants: number
  suspended_restaurants: number
  orders_today: number
  gross_order_value_today_pence: number
  orders_needing_attention: number
  recent_applications: Array<{
    id: string
    name: string
    slug: string
    submitted_at: string | null
    cuisines: string[] | null
    logo_url: string | null
  }>
}

export default function Overview() {
  const { admin } = useAdmin()
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: overview, error: loadError } = await supabase.rpc('get_platform_admin_overview')
    if (loadError) setError(loadError.message)
    else setData(overview as OverviewData)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="admin-page">
      <header className="page-heading">
        <div><span className="admin-kicker">Live operations</span><h1>Good {greeting()}, {admin.display_name}.</h1><p>Here is what needs attention across ordered.food today.</p></div>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>↻ Refresh</button>
      </header>

      {error && <div className="admin-alert error" role="alert">{error}</div>}

      <section className="metric-grid" aria-label="Platform overview">
        <Metric label="Pending review" value={loading ? '—' : String(data?.pending_restaurants ?? 0)} tone="amber" detail="Restaurant applications" />
        <Metric label="Live restaurants" value={loading ? '—' : String(data?.active_restaurants ?? 0)} tone="green" detail={`${data?.suspended_restaurants ?? 0} suspended`} />
        <Metric label="Paid orders today" value={loading ? '—' : String(data?.orders_today ?? 0)} tone="blue" detail={`${data?.orders_needing_attention ?? 0} awaiting acceptance`} />
        <Metric label="Gross order value" value={loading ? '—' : formatMoney(data?.gross_order_value_today_pence)} tone="pink" detail="Paid orders today" />
      </section>

      <div className="overview-grid">
        <section className="admin-panel">
          <div className="panel-heading"><div><h2>Applications to review</h2><p>Oldest submissions appear first.</p></div><Link to="/restaurants?status=pending_approval">View all</Link></div>
          {loading && <div className="panel-empty">Loading applications…</div>}
          {!loading && !data?.recent_applications.length && <div className="panel-empty"><strong>Queue clear</strong><span>There are no restaurant applications waiting.</span></div>}
          <div className="application-list">
            {data?.recent_applications.map((application) => (
              <Link to={`/restaurants?status=pending_approval&restaurant=${application.id}`} className="application-row" key={application.id}>
                <span className="restaurant-logo">{application.logo_url ? <img src={application.logo_url} alt="" /> : application.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{application.name}</strong><small>{application.cuisines?.join(' · ') || 'Cuisine not provided'}</small></span>
                <span><small>Submitted</small><strong>{formatDate(application.submitted_at, false)}</strong></span>
                <span aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        </section>

        <aside className="admin-panel attention-panel">
          <div className="panel-heading"><div><h2>Operational attention</h2><p>Items worth checking now.</p></div></div>
          <Link to="/restaurants?status=pending_approval" className="attention-row"><span className="attention-icon amber">!</span><span><strong>{data?.pending_restaurants ?? 0} applications pending</strong><small>Review identity, menu and service details.</small></span><span>›</span></Link>
          <Link to="/restaurants?status=suspended" className="attention-row"><span className="attention-icon red">×</span><span><strong>{data?.suspended_restaurants ?? 0} restaurants suspended</strong><small>Review status and any reactivation notes.</small></span><span>›</span></Link>
          <div className="attention-row muted"><span className="attention-icon blue">●</span><span><strong>{data?.orders_needing_attention ?? 0} orders awaiting response</strong><small>Full order monitoring is the next admin milestone.</small></span></div>
        </aside>
      </div>
    </div>
  )
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className="metric"><span className={`metric-dot ${tone}`} /><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>
}

function greeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'
}
