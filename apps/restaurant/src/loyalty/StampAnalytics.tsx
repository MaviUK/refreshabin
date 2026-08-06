import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './StampAnalytics.css'

type Summary = {
  active_campaigns: number
  active_collectors: number
  stamps_issued: number
  cards_completed: number
  qr_claims: number
  manual_adjustments: number
  completion_rate: number
}

type Campaign = {
  program_id: string
  program_name: string
  is_active: boolean
  stamps_required: number
  collectors: number
  stamps_issued: number
  completions: number
  completion_rate: number
  qr_claims: number
}

type NearCompletion = {
  card_id: string
  customer_user_id: string
  program_name: string
  current_stamps: number
  stamps_required: number
  remaining_stamps: number
  last_stamp_at: string | null
}

type DailyActivity = {
  activity_date: string
  stamps: number
  completions: number
  qr_claims: number
}

type Dashboard = {
  summary: Summary
  campaigns: Campaign[]
  near_completion: NearCompletion[]
  daily_activity: DailyActivity[]
}

const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })

export default function StampAnalytics() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('get_restaurant_stamp_analytics')
    if (rpcError) setError(rpcError.message)
    else setDashboard(data as Dashboard)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const maxDailyStamps = useMemo(() => Math.max(1, ...(dashboard?.daily_activity || []).map((row) => row.stamps)), [dashboard])

  if (loading) return <main className="stamp-analytics-page stamp-analytics-state">Loading stamp analytics…</main>

  const summary = dashboard?.summary || {
    active_campaigns: 0,
    active_collectors: 0,
    stamps_issued: 0,
    cards_completed: 0,
    qr_claims: 0,
    manual_adjustments: 0,
    completion_rate: 0,
  }

  return <main className="stamp-analytics-page">
    <header className="stamp-analytics-header">
      <div><span>Loyalty intelligence</span><h1>Stamp analytics</h1><p>Measure campaign adoption, completion and QR engagement across your restaurant.</p></div>
      <nav><Link to="/loyalty/stamps">Campaigns</Link><Link to="/loyalty/stamps/operations">QR & staff tools</Link><button type="button" onClick={() => void load()}>Refresh</button></nav>
    </header>

    {error && <p className="stamp-analytics-error" role="alert">{error}</p>}

    <section className="stamp-analytics-metrics">
      <article><span>Active campaigns</span><strong>{summary.active_campaigns}</strong></article>
      <article><span>Active collectors</span><strong>{summary.active_collectors}</strong></article>
      <article><span>Stamps issued</span><strong>{summary.stamps_issued}</strong></article>
      <article><span>Cards completed</span><strong>{summary.cards_completed}</strong></article>
      <article><span>Completion rate</span><strong>{Number(summary.completion_rate).toFixed(1)}%</strong></article>
      <article><span>QR claims</span><strong>{summary.qr_claims}</strong></article>
    </section>

    <section className="stamp-analytics-grid">
      <article className="stamp-analytics-card stamp-analytics-trend">
        <header><div><span>Last 30 days</span><h2>Stamp activity</h2></div><small>Daily stamps issued</small></header>
        <div className="stamp-bars" aria-label="Thirty day stamp activity">{(dashboard?.daily_activity || []).map((row) => <div key={row.activity_date} title={`${date.format(new Date(row.activity_date))}: ${row.stamps} stamps`}><i style={{ height: `${Math.max(4, (row.stamps / maxDailyStamps) * 100)}%` }} /><span>{new Date(row.activity_date).getDate()}</span></div>)}</div>
      </article>

      <article className="stamp-analytics-card">
        <header><div><span>Retention opportunities</span><h2>Closest to a reward</h2></div><small>{dashboard?.near_completion.length || 0} customers</small></header>
        <div className="stamp-near-list">{dashboard?.near_completion.length ? dashboard.near_completion.map((row) => <div key={row.card_id}><div><strong>{row.program_name}</strong><small>Customer {row.customer_user_id.slice(0, 8)}…</small></div><div><span>{row.current_stamps}/{row.stamps_required}</span><strong>{row.remaining_stamps} left</strong></div></div>) : <p>No customers are currently one or two stamps away.</p>}</div>
      </article>
    </section>

    <section className="stamp-analytics-card stamp-campaign-performance">
      <header><div><span>Performance</span><h2>Campaign comparison</h2></div><small>{dashboard?.campaigns.length || 0} campaigns</small></header>
      <div className="stamp-analytics-table-wrap"><table><thead><tr><th>Campaign</th><th>Collectors</th><th>Stamps</th><th>Completed</th><th>Completion</th><th>QR claims</th></tr></thead><tbody>{dashboard?.campaigns.map((campaign) => <tr key={campaign.program_id}><td><strong>{campaign.program_name}</strong><small>{campaign.is_active ? 'Active' : 'Paused'} · {campaign.stamps_required} stamps required</small></td><td>{campaign.collectors}</td><td>{campaign.stamps_issued}</td><td>{campaign.completions}</td><td>{Number(campaign.completion_rate).toFixed(1)}%</td><td>{campaign.qr_claims}</td></tr>)}</tbody></table></div>
    </section>
  </main>
}
