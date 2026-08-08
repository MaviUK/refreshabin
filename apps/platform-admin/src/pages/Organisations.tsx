import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { hasAdminPermission } from '../types'

type Group = {
  id: string
  name: string
  slug: string
  group_type: string
  status: string
  default_currency: string
  countries: string[]
  enterprise_plan_code: string | null
  locations: number
  brands: number
  members: number
  created_at: string
}

type EnterpriseAnalytics = {
  trend?: Array<{ trend_day: string; revenue_pence: number; orders: number; customers: number }>
  locations?: Array<{ restaurant_id: string; name: string; revenue_pence: number; orders: number; revenue_vs_average_percent: number }>
  benchmark?: { average_revenue_pence?: number; median_revenue_pence?: number; average_orders?: number }
  ai_comparison?: unknown[]
  insights?: unknown[]
}

const pretty = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, match => match.toUpperCase())
const money = (pence: number | null | undefined) => `£${((Number(pence) || 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Organisations() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'restaurants:manage')
  const [groups, setGroups] = useState<Group[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [analytics, setAnalytics] = useState<EnterpriseAnalytics | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [create, setCreate] = useState({ name: '', slug: '', group_type: 'parent_company', currency: 'GBP', countries: 'GB', plan: '' })
  const [action, setAction] = useState({ type: '', reason: '', restaurant_id: '', target_restaurant_id: '', target_group_id: '', brand_id: '', plan: '', admin_email: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: requestError } = await supabase.rpc('get_platform_restaurant_groups', { p_search: search.trim() || null, p_page: 1, p_page_size: 100 })
    if (requestError) {
      setError(requestError.message)
      setGroups([])
    } else {
      const rows = (data as any)?.groups ?? []
      setGroups(rows)
      setSelectedId(current => rows.some((row: Group) => row.id === current) ? current : rows[0]?.id ?? '')
    }
    setLoading(false)
  }, [search])

  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null)
      setAnalytics(null)
      return
    }
    const [detailResult, analyticsResult] = await Promise.all([
      supabase.rpc('get_platform_restaurant_group', { p_group_id: id }),
      supabase.rpc('get_restaurant_group_analytics', { p_group_id: id, p_scope_type: 'group', p_scope_id: null, p_days: 30 }),
    ])
    if (detailResult.error) setError(detailResult.error.message)
    else setDetail(detailResult.data)
    if (analyticsResult.error) setError(analyticsResult.error.message)
    else setAnalytics((analyticsResult.data as EnterpriseAnalytics) ?? null)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const selected = useMemo(() => groups.find(group => group.id === selectedId) ?? null, [groups, selectedId])

  async function refresh(messageText?: string) {
    await load()
    if (selectedId) await loadDetail(selectedId)
    if (messageText) setMessage(messageText)
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    const { data, error: requestError } = await supabase.rpc('platform_create_restaurant_group', {
      p_name: create.name,
      p_slug: create.slug,
      p_group_type: create.group_type,
      p_default_currency: create.currency.toUpperCase(),
      p_countries: create.countries.split(',').map(value => value.trim().toUpperCase()).filter(Boolean),
      p_enterprise_plan_code: create.plan || null,
    })
    if (requestError) setError(requestError.message)
    else {
      setCreate({ name: '', slug: '', group_type: 'parent_company', currency: 'GBP', countries: 'GB', plan: '' })
      await load()
      if (data) setSelectedId(String(data))
      setMessage('Organisation created with enterprise roles and security defaults.')
    }
    setSaving(false)
  }

  async function manage(type: string, payload: Record<string, unknown> = {}) {
    if (!selected) return
    setSaving(true)
    setError('')
    setMessage('')
    const { error: requestError } = await supabase.rpc('platform_manage_restaurant_group', {
      p_group_id: selected.id,
      p_action: type,
      p_payload: payload,
      p_reason: action.reason || null,
    })
    if (requestError) setError(requestError.message)
    else {
      setAction({ ...action, type: '', reason: '' })
      await refresh(`Organisation ${type} completed.`)
    }
    setSaving(false)
  }

  async function transfer(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const target = action.target_group_id || selectedId
    const { error: requestError } = await supabase.rpc('platform_transfer_restaurant_to_group', {
      p_restaurant_id: action.restaurant_id,
      p_group_id: target,
      p_brand_id: null,
      p_region_id: null,
      p_reason: action.reason || 'Platform organisation transfer',
    })
    if (requestError) setError(requestError.message)
    else await refresh('Restaurant transferred with audit history preserved.')
    setSaving(false)
  }

  async function merge(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const { error: requestError } = await supabase.rpc('platform_merge_restaurants', {
      p_source_restaurant_id: action.restaurant_id,
      p_target_restaurant_id: action.target_restaurant_id,
      p_reason: action.reason,
    })
    if (requestError) setError(requestError.message)
    else await refresh('Restaurants merged; the source location was suspended and history retained.')
    setSaving(false)
  }

  async function moveBrand(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const { error: requestError } = await supabase.rpc('platform_move_brand', {
      p_brand_id: action.brand_id,
      p_target_group_id: action.target_group_id,
      p_reason: action.reason,
    })
    if (requestError) setError(requestError.message)
    else await refresh('Brand moved to the target organisation.')
    setSaving(false)
  }

  async function assignCorporateAdmin(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setSaving(true)
    setError('')
    setMessage('')
    const { error: requestError } = await supabase.rpc('platform_assign_restaurant_group_admin_by_email', {
      p_group_id: selected.id,
      p_email: action.admin_email.trim(),
      p_reason: action.reason || 'Platform corporate administrator assignment',
    })
    if (requestError) setError(requestError.message)
    else {
      setAction({ ...action, admin_email: '', reason: '' })
      await refresh('Corporate administrator assigned and audit history recorded.')
    }
    setSaving(false)
  }

  return <div className="admin-page restaurants-page">
    <header className="page-heading"><div><span className="admin-kicker">Enterprise operations</span><h1>Organisations</h1><p>Create groups, manage enterprise plans, move brands and restaurants, merge locations and inspect corporate analytics and audit history.</p></div></header>
    {error && <div className="admin-alert error">{error}</div>}
    {message && <div className="admin-alert success">{message}</div>}
    <div className="restaurant-toolbar"><label className="admin-search"><span>⌕</span><input type="search" placeholder="Search organisations…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="restaurant-workspace">
      <section className="restaurant-list"><div className="list-heading"><strong>{loading ? 'Loading…' : `${groups.length} organisations`}</strong><small>Enterprise & multi-location</small></div>{groups.map(group => <button type="button" className={`restaurant-list-row ${selectedId === group.id ? 'active' : ''}`} onClick={() => setSelectedId(group.id)} key={group.id}><span className="restaurant-logo">{group.name.slice(0, 1).toUpperCase()}</span><span><strong>{group.name}</strong><small>{group.locations} locations · {group.brands} brands · {group.members} staff</small></span><span className={`status-badge ${group.status}`}>{pretty(group.status)}</span></button>)}</section>
      <section className="restaurant-detail">{!selected ? <div className="panel-empty"><strong>Select an organisation</strong></div> : <>
        <div className="restaurant-detail-header"><div className="restaurant-identity"><span className="restaurant-logo large">{selected.name.slice(0, 1).toUpperCase()}</span><div><span className={`status-badge ${selected.status}`}>{pretty(selected.status)}</span><h2>{selected.name}</h2><p>{pretty(selected.group_type)} · {selected.default_currency} · {selected.countries?.join(', ')}</p></div></div></div>
        <div className="restaurant-summary"><Summary label="Locations" value={String(selected.locations)} /><Summary label="Brands" value={String(selected.brands)} /><Summary label="Enterprise plan" value={selected.enterprise_plan_code || 'Not assigned'} /></div>
        {analytics && <section className="admin-card"><span className="admin-kicker">Enterprise analytics · 30 days</span><h3>Group performance</h3><div className="restaurant-summary"><Summary label="Avg location revenue" value={money(analytics.benchmark?.average_revenue_pence)} /><Summary label="Median location revenue" value={money(analytics.benchmark?.median_revenue_pence)} /><Summary label="Avg orders / location" value={String(analytics.benchmark?.average_orders ?? 0)} /><Summary label="AI insights" value={String(analytics.insights?.length ?? 0)} /></div><div className="table-scroll"><table><thead><tr><th>Location</th><th>Revenue</th><th>Orders</th><th>vs group avg</th></tr></thead><tbody>{(analytics.locations ?? []).map(location => <tr key={location.restaurant_id}><td><strong>{location.name}</strong></td><td>{money(location.revenue_pence)}</td><td>{location.orders}</td><td>{Number(location.revenue_vs_average_percent || 0).toFixed(1)}%</td></tr>)}</tbody></table></div></section>}
        {detail && <><section className="admin-card"><span className="admin-kicker">Organisation structure</span><h3>Brands & locations</h3><div className="table-scroll"><table><thead><tr><th>Location</th><th>Brand</th><th>Region</th><th>Status</th><th>Currency</th></tr></thead><tbody>{(detail.locations ?? []).map((location: any) => <tr key={location.restaurant_id}><td><strong>{location.name}</strong><small>/{location.slug}</small></td><td>{detail.brands?.find((brand: any) => brand.id === location.brand_id)?.name || '—'}</td><td>{detail.regions?.find((region: any) => region.id === location.region_id)?.name || '—'}</td><td>{pretty(location.status)}</td><td>{location.currency}</td></tr>)}</tbody></table></div></section>
        <section className="admin-card"><span className="admin-kicker">Corporate audit log</span><h3>Latest activity</h3><div className="table-scroll"><table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead><tbody>{(detail.audit ?? []).slice(0, 50).map((entry: any) => <tr key={entry.id}><td>{new Date(entry.created_at).toLocaleString('en-GB')}</td><td>{entry.action}</td><td>{entry.target_type}</td><td>{entry.reason || '—'}</td></tr>)}</tbody></table></div></section></>}
        {canManage && <><div className="restaurant-actions"><button className="secondary-button" onClick={() => setAction({ ...action, type: 'plan', plan: selected.enterprise_plan_code || '' })}>Enterprise plan</button>{selected.status === 'active' ? <button className="danger-button ghost" onClick={() => setAction({ ...action, type: 'suspend' })}>Suspend organisation</button> : <button className="admin-primary-button" onClick={() => void manage('resume')}>Resume organisation</button>}</div>
        {action.type && <section className="action-confirmation"><div><span className="admin-kicker">Platform control</span><h3>{pretty(action.type)} organisation</h3></div>{action.type === 'plan' ? <><label>Enterprise plan code<input value={action.plan} onChange={event => setAction({ ...action, plan: event.target.value })} /></label><div className="confirmation-buttons"><button className="secondary-button" onClick={() => setAction({ ...action, type: '' })}>Cancel</button><button className="admin-primary-button" disabled={saving} onClick={() => void manage('update', { enterprise_plan_code: action.plan || null })}>Save plan</button></div></> : <><label>Reason<textarea required rows={3} value={action.reason} onChange={event => setAction({ ...action, reason: event.target.value })} /></label><div className="confirmation-buttons"><button className="secondary-button" onClick={() => setAction({ ...action, type: '' })}>Cancel</button><button className="danger-button" disabled={saving || action.reason.trim().length < 5} onClick={() => void manage(action.type)}>Confirm</button></div></>}</section>}
        <div className="admin-grid two">
          <form className="admin-card" onSubmit={transfer}><span className="admin-kicker">Restaurant transfer</span><h3>Move restaurant</h3><input required placeholder="Restaurant UUID" value={action.restaurant_id} onChange={event => setAction({ ...action, restaurant_id: event.target.value })} /><select value={action.target_group_id} onChange={event => setAction({ ...action, target_group_id: event.target.value })}><option value="">This organisation</option>{groups.filter(group => group.id !== selected.id).map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select><textarea required placeholder="Reason" value={action.reason} onChange={event => setAction({ ...action, reason: event.target.value })} /><button className="admin-primary-button" disabled={saving}>Transfer</button></form>
          <form className="admin-card" onSubmit={merge}><span className="admin-kicker">Safe merge</span><h3>Merge restaurants</h3><input required placeholder="Source restaurant UUID" value={action.restaurant_id} onChange={event => setAction({ ...action, restaurant_id: event.target.value })} /><input required placeholder="Target restaurant UUID" value={action.target_restaurant_id} onChange={event => setAction({ ...action, target_restaurant_id: event.target.value })} /><textarea required minLength={5} placeholder="Reason" value={action.reason} onChange={event => setAction({ ...action, reason: event.target.value })} /><button className="danger-button" disabled={saving}>Merge & suspend source</button></form>
          <form className="admin-card" onSubmit={moveBrand}><span className="admin-kicker">Brand ownership</span><h3>Move brand</h3><select required value={action.brand_id} onChange={event => setAction({ ...action, brand_id: event.target.value })}><option value="">Select brand</option>{(detail?.brands ?? []).map((brand: any) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select><select required value={action.target_group_id} onChange={event => setAction({ ...action, target_group_id: event.target.value })}><option value="">Target organisation</option>{groups.filter(group => group.id !== selected.id).map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select><textarea required minLength={5} placeholder="Reason" value={action.reason} onChange={event => setAction({ ...action, reason: event.target.value })} /><button className="admin-primary-button" disabled={saving}>Move brand</button></form>
          <form className="admin-card" onSubmit={assignCorporateAdmin}><span className="admin-kicker">Corporate access</span><h3>Assign corporate admin</h3><input required type="email" placeholder="Existing user email" value={action.admin_email} onChange={event => setAction({ ...action, admin_email: event.target.value })} /><textarea required minLength={5} placeholder="Reason" value={action.reason} onChange={event => setAction({ ...action, reason: event.target.value })} /><button className="admin-primary-button" disabled={saving}>Assign administrator</button></form>
        </div></>}
      </>}</section>
    </div>
    {canManage && <form className="admin-card" onSubmit={createGroup} style={{ marginTop: 20 }}><span className="admin-kicker">New enterprise customer</span><h2>Create organisation</h2><div className="admin-grid two"><label>Name<input required value={create.name} onChange={event => setCreate({ ...create, name: event.target.value })} /></label><label>Slug<input required value={create.slug} onChange={event => setCreate({ ...create, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></label><label>Type<select value={create.group_type} onChange={event => setCreate({ ...create, group_type: event.target.value })}>{['parent_company', 'franchise_group', 'independent_chain', 'corporate_ownership'].map(value => <option value={value} key={value}>{pretty(value)}</option>)}</select></label><label>Currency<input maxLength={3} value={create.currency} onChange={event => setCreate({ ...create, currency: event.target.value.toUpperCase() })} /></label><label>Countries<input placeholder="GB, IE" value={create.countries} onChange={event => setCreate({ ...create, countries: event.target.value })} /></label><label>Enterprise plan<input placeholder="enterprise-pro" value={create.plan} onChange={event => setCreate({ ...create, plan: event.target.value })} /></label></div><button className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Create organisation'}</button></form>}
  </div>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}
