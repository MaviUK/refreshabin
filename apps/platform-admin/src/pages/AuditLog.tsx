import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate } from '../types'

type AuditEntry = { id: number; actor_user_id: string; action: string; target_type: string; target_id: string | null; details: Record<string, unknown>; created_at: string; actor_name: string; actor_email: string }
type AuditSnapshot = {
  entries: AuditEntry[]
  pagination: { page: number; page_size: number; total: number; total_pages: number }
  filters: { actions: string[]; target_types: string[]; actors: Array<{ user_id: string; actor_name: string; actor_email: string }> }
}
const emptySnapshot: AuditSnapshot = { entries: [], pagination: { page: 1, page_size: 50, total: 0, total_pages: 1 }, filters: { actions: [], target_types: [], actors: [] } }

export default function AuditLog() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('search') ?? '')
  const [action, setAction] = useState(params.get('action') ?? '')
  const [targetType, setTargetType] = useState(params.get('target') ?? '')
  const [actor, setActor] = useState(params.get('actor') ?? '')
  const [dateRange, setDateRange] = useState(params.get('range') ?? '')
  const [page, setPage] = useState(Math.max(Number(params.get('page')) || 1, 1))
  const [snapshot, setSnapshot] = useState<AuditSnapshot>(emptySnapshot)
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const range = rangeBounds(dateRange)
    const { data, error: loadError } = await supabase.rpc('get_platform_admin_audit_log', {
      p_action: action || null, p_target_type: targetType || null, p_actor_user_id: actor || null,
      p_search: search.trim() || null, p_from: range.from, p_to: range.to, p_page: page, p_page_size: 50,
    })
    if (loadError) setError(loadError.message)
    else setSnapshot(data as AuditSnapshot)
    setLoading(false)
  }, [action, actor, dateRange, page, search, targetType])

  useEffect(() => { const timer = window.setTimeout(() => void load(), search ? 300 : 0); return () => window.clearTimeout(timer) }, [load, search])
  useEffect(() => {
    const next = new URLSearchParams()
    if (search) next.set('search', search); if (action) next.set('action', action); if (targetType) next.set('target', targetType)
    if (actor) next.set('actor', actor); if (dateRange) next.set('range', dateRange); if (page > 1) next.set('page', String(page))
    setParams(next, { replace: true })
  }, [action, actor, dateRange, page, search, setParams, targetType])

  const filtered = useMemo(() => Boolean(search || action || targetType || actor || dateRange), [action, actor, dateRange, search, targetType])
  function resetFilters() { setSearch(''); setAction(''); setTargetType(''); setActor(''); setDateRange(''); setPage(1) }

  return <div className="admin-page">
    <header className="page-heading"><div><span className="admin-kicker">Accountability</span><h1>Audit log</h1><p>Search and inspect the permanent record of sensitive platform actions.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>↻ Refresh</button></header>
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    <section className="admin-panel audit-filters" aria-label="Audit filters">
      <label className="audit-search"><span>Search activity</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Action, restaurant, reason or administrator…" /></label>
      <Filter label="Action" value={action} onChange={(value) => { setAction(value); setPage(1) }} options={snapshot.filters.actions} />
      <Filter label="Target" value={targetType} onChange={(value) => { setTargetType(value); setPage(1) }} options={snapshot.filters.target_types} />
      <label><span>Administrator</span><select value={actor} onChange={(event) => { setActor(event.target.value); setPage(1) }}><option value="">All administrators</option>{snapshot.filters.actors.map((value) => <option value={value.user_id} key={value.user_id}>{value.actor_name}</option>)}</select></label>
      <label><span>When</span><select value={dateRange} onChange={(event) => { setDateRange(event.target.value); setPage(1) }}><option value="">All time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
      {filtered && <button className="filter-clear" type="button" onClick={resetFilters}>Clear filters</button>}
    </section>
    <section className="admin-panel audit-panel">
      {loading && <div className="panel-empty">Loading activity…</div>}
      {!loading && snapshot.entries.length === 0 && <div className="panel-empty"><strong>{filtered ? 'No matching activity' : 'No admin actions yet'}</strong><span>{filtered ? 'Try clearing one or more filters.' : 'Approvals and status changes will appear here.'}</span></div>}
      {!loading && snapshot.entries.map((entry) => <button type="button" className="audit-row" key={entry.id} onClick={() => setSelected(entry)}><span className={`audit-icon ${isRiskAction(entry.action) ? 'risk' : ''}`}>{isRiskAction(entry.action) ? '!' : '✓'}</span><div><strong>{humanise(entry.action)}</strong><p>{describe(entry)}</p><small>{entry.actor_name} · {entry.actor_email}</small></div><time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time></button>)}
    </section>
    {!loading && snapshot.pagination.total > 0 && <footer className="admin-pagination"><span>Showing {(snapshot.pagination.page - 1) * snapshot.pagination.page_size + 1}–{Math.min(snapshot.pagination.page * snapshot.pagination.page_size, snapshot.pagination.total)} of {snapshot.pagination.total}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>Previous</button><strong>Page {snapshot.pagination.page} of {snapshot.pagination.total_pages}</strong><button type="button" disabled={page >= snapshot.pagination.total_pages} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>}
    {selected && <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setSelected(null)}><section className="admin-modal audit-detail-modal" role="dialog" aria-modal="true" aria-labelledby="audit-detail-heading" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="admin-kicker">Audit event #{selected.id}</span><h2 id="audit-detail-heading">{humanise(selected.action)}</h2></div><button type="button" aria-label="Close" onClick={() => setSelected(null)}>×</button></div><dl className="audit-detail-grid"><div><dt>Administrator</dt><dd>{selected.actor_name}<small>{selected.actor_email}</small></dd></div><div><dt>Recorded</dt><dd>{formatDate(selected.created_at)}</dd></div><div><dt>Target</dt><dd>{humanise(selected.target_type)}<small>{selected.target_id ?? 'No target ID'}</small></dd></div></dl><div className="audit-detail-data"><strong>Recorded details</strong>{Object.keys(selected.details).length ? <dl>{Object.entries(selected.details).map(([key, value]) => <div key={key}><dt>{humanise(key)}</dt><dd>{displayValue(value)}</dd></div>)}</dl> : <p>No additional details were recorded.</p>}</div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setSelected(null)}>Close</button></div></section></div>}
  </div>
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All {label.toLowerCase()}s</option>{options.map((option) => <option value={option} key={option}>{humanise(option)}</option>)}</select></label>
}
function humanise(value: string) { return value.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') }
function describe(entry: AuditEntry) { const name = typeof entry.details.restaurant_name === 'string' ? entry.details.restaurant_name : humanise(entry.target_type); const reason = typeof entry.details.reason === 'string' ? entry.details.reason : ''; return reason ? `${name} · ${reason}` : name }
function isRiskAction(action: string) { return ['suspend', 'reject', 'deactivate', 'revoke', 'cancel', 'refund'].some((word) => action.includes(word)) }
function displayValue(value: unknown) { if (value === null || value === undefined || value === '') return 'Not recorded'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; if (typeof value === 'object') return JSON.stringify(value); return String(value) }
function rangeBounds(value: string) { if (!value) return { from: null, to: null }; const now = new Date(); const from = new Date(now); if (value === 'today') from.setHours(0, 0, 0, 0); else if (value === '7d') from.setDate(from.getDate() - 7); else if (value === '30d') from.setDate(from.getDate() - 30); else return { from: null, to: null }; return { from: from.toISOString(), to: now.toISOString() } }
