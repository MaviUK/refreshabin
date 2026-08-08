import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, hasAdminPermission } from '../types'

type ModerationStatus = 'open' | 'in_review' | 'actioned' | 'dismissed'
type SubjectType = 'restaurant' | 'menu_item' | 'menu_import'
type Severity = 'low' | 'normal' | 'high' | 'urgent'

type ModerationEntry = {
  id: string
  reference: number
  source: 'admin' | 'system' | 'customer'
  subject_type: SubjectType
  category: string
  severity: Severity
  summary: string
  status: ModerationStatus
  enforcement_action: string | null
  restaurant_id: string
  restaurant_name: string
  subject_name: string
  assigned_to_name: string | null
  created_at: string
  updated_at: string
}

type Queue = {
  entries: ModerationEntry[]
  metrics: { open: number; urgent: number; unassigned: number; failed_imports: number }
  pagination: { page: number; page_size: number; total: number; total_pages: number }
}

type Activity = { id: string; event_type: string; note: string | null; actor_name: string; created_at: string }
type Detail = {
  report: ModerationEntry & {
    details: string
    resolution: string | null
    resolved_at: string | null
    assigned_to: string | null
    enforcement_snapshot: Record<string, unknown>
    target_state: Record<string, unknown>
    restaurant_slug: string
  }
  activity: Activity[]
}

type Target = { id: string; subject_type: 'restaurant' | 'menu_item'; name: string; restaurant_name: string; context: string }
type PendingAction = { action: string; title: string; description: string; danger?: boolean }

const emptyQueue: Queue = { entries: [], metrics: { open: 0, urgent: 0, unassigned: 0, failed_imports: 0 }, pagination: { page: 1, page_size: 30, total: 0, total_pages: 1 } }
const statusOptions = ['open', 'in_review', 'actioned', 'dismissed'] as const
const subjectOptions = ['all', 'restaurant', 'menu_item', 'menu_import'] as const
const severityOptions = ['all', 'low', 'normal', 'high', 'urgent'] as const
const categoryOptions = ['misleading_content', 'allergen_risk', 'prohibited_content', 'incorrect_pricing', 'quality', 'duplicate', 'other']

export default function Moderation() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'moderation:manage')
  const [queue, setQueue] = useState<Queue>(emptyQueue)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('open')
  const [subject, setSubject] = useState<string>('all')
  const [severity, setSeverity] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reason, setReason] = useState('')

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_moderation_queue', {
      p_search: search.trim() || null,
      p_status: status,
      p_subject_type: subject,
      p_severity: severity,
      p_page: page,
      p_page_size: 30,
    })
    if (loadError) setError(loadError.message)
    else {
      const next = data as Queue
      setQueue(next)
      if (selected && !next.entries.some((entry) => entry.id === selected)) {
        setSelected(null)
        setDetail(null)
      }
    }
    setLoading(false)
  }, [page, search, selected, severity, status, subject])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setError('')
    const { data, error: detailError } = await supabase.rpc('get_platform_moderation_report', { p_report_id: id })
    if (detailError) setError(detailError.message)
    else setDetail(data as Detail)
    setDetailLoading(false)
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void loadQueue(), 250); return () => window.clearTimeout(timer) }, [loadQueue])
  useEffect(() => { if (selected) void loadDetail(selected) }, [loadDetail, selected])

  async function performAction(event: FormEvent) {
    event.preventDefault()
    if (!pending || !detail || saving) return
    if (reason.trim().length < 5) return setError('Enter a clear reason of at least 5 characters.')
    setSaving(true)
    setError('')
    setSuccess('')
    const { error: actionError } = await supabase.rpc('manage_platform_moderation_report', {
      p_report_id: detail.report.id,
      p_action: pending.action,
      p_reason: reason,
      p_expected_updated_at: detail.report.updated_at,
    })
    setSaving(false)
    if (actionError) return setError(actionError.message)
    setPending(null)
    setReason('')
    setSuccess(`${pending.title} completed and recorded in the audit log.`)
    await Promise.all([loadQueue(), loadDetail(detail.report.id)])
  }

  function requestAction(action: string, title: string, description: string, danger = false) {
    setReason('')
    setPending({ action, title, description, danger })
  }

  return <div className="admin-page moderation-page">
    <header className="page-heading"><div><span className="admin-kicker">Trust & safety</span><h1>Content moderation</h1><p>Investigate restaurant and product reports, AI menu-import failures, and every enforcement decision.</p></div>{canManage && <button className="admin-primary-button" type="button" onClick={() => setShowNew(true)}>＋ New report</button>}</header>
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {success && <div className="admin-alert success" role="status">{success}</div>}

    <section className="moderation-metrics" aria-label="Moderation queue metrics">
      <Metric label="Open reports" value={queue.metrics.open} tone="pink" />
      <Metric label="Urgent" value={queue.metrics.urgent} tone="red" />
      <Metric label="Unassigned" value={queue.metrics.unassigned} tone="amber" />
      <Metric label="Failed imports" value={queue.metrics.failed_imports} tone="blue" />
    </section>

    <section className="moderation-toolbar">
      <label className="admin-search moderation-search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search reports, restaurants or items…" /></label>
      <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>{statusOptions.map((option) => <option key={option} value={option}>{humanise(option)}</option>)}</select></label>
      <label>Content<select value={subject} onChange={(event) => { setSubject(event.target.value); setPage(1) }}>{subjectOptions.map((option) => <option key={option} value={option}>{humanise(option)}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(1) }}>{severityOptions.map((option) => <option key={option} value={option}>{humanise(option)}</option>)}</select></label>
      <button className="secondary-button" type="button" onClick={() => void loadQueue()} disabled={loading}>↻ Refresh</button>
    </section>

    <div className="moderation-workspace">
      <section className="moderation-list" aria-label="Moderation reports">
        <div className="list-heading"><strong>{loading ? 'Loading…' : `${queue.pagination.total} report${queue.pagination.total === 1 ? '' : 's'}`}</strong><small>Page {queue.pagination.page} of {queue.pagination.total_pages}</small></div>
        {!loading && !queue.entries.length && <div className="panel-empty"><strong>Queue clear</strong><span>No moderation reports match these filters.</span></div>}
        {queue.entries.map((entry) => <button key={entry.id} type="button" className={`moderation-row${selected === entry.id ? ' active' : ''}`} onClick={() => setSelected(entry.id)}>
          <span className={`moderation-severity ${entry.severity}`} aria-hidden="true" />
          <span><strong>MOD-{entry.reference} · {entry.summary}</strong><small>{entry.restaurant_name} · {entry.subject_name}</small><small>{formatDate(entry.created_at)}</small></span>
          <span><i className={`moderation-status ${entry.status}`}>{humanise(entry.status)}</i><small>{entry.assigned_to_name || 'Unassigned'}</small></span>
        </button>)}
        {queue.pagination.total_pages > 1 && <div className="order-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Previous</button><span>{page} / {queue.pagination.total_pages}</span><button type="button" disabled={page >= queue.pagination.total_pages || loading} onClick={() => setPage((value) => value + 1)}>Next →</button></div>}
      </section>

      <section className="moderation-detail">
        {!selected && <div className="panel-empty"><strong>Select a report</strong><span>Open an item from the queue to investigate and act.</span></div>}
        {selected && detailLoading && <div className="panel-empty">Loading report…</div>}
        {selected && !detailLoading && detail && <>
          <header className="moderation-detail-header"><div><span className="admin-kicker">MOD-{detail.report.reference} · {humanise(detail.report.subject_type)}</span><h2>{detail.report.summary}</h2><p>{detail.report.details}</p></div><i className={`moderation-status ${detail.report.status}`}>{humanise(detail.report.status)}</i></header>
          <div className="moderation-facts"><article><small>Restaurant</small><strong>{detail.report.restaurant_name}</strong></article><article><small>Subject</small><strong>{detail.report.subject_name}</strong></article><article><small>Owner</small><strong>{detail.report.assigned_to_name || 'Unassigned'}</strong></article><article><small>Severity</small><strong>{humanise(detail.report.severity)}</strong></article></div>
          <div className="moderation-links"><Link to={`/restaurants?restaurant=${detail.report.restaurant_id}`}>Open restaurant profile</Link>{detail.report.restaurant_slug && <a href={`/r/${detail.report.restaurant_slug}`} target="_blank" rel="noreferrer">View storefront ↗</a>}</div>
          {detail.report.subject_type === 'menu_import' && <div className="moderation-import-error"><strong>AI import failure</strong><span>{String(detail.report.target_state.error_message || 'No error detail was retained.')}</span><small>{String(detail.report.target_state.file_name || '')} · {formatDate(String(detail.report.target_state.created_at || ''))}</small></div>}
          {detail.report.enforcement_action && <div className="moderation-enforcement"><strong>Current enforcement</strong><span>{humanise(detail.report.enforcement_action)}</span></div>}

          {canManage && <div className="moderation-actions">
            {!detail.report.assigned_to && <button className="secondary-button" type="button" onClick={() => requestAction('assign_to_me', 'Claim report', 'Assign this report to you and move it into review.')}>Claim</button>}
            {detail.report.status === 'open' && <button className="secondary-button" type="button" onClick={() => requestAction('start_review', 'Start review', 'Mark this report as actively under investigation.')}>Start review</button>}
            {!detail.report.enforcement_action && detail.report.subject_type !== 'menu_import' && <button className="danger-button ghost" type="button" onClick={() => requestAction('hide_content', 'Hide content', 'Remove this content from customer ordering while retaining its data and moderation history.', true)}>Hide</button>}
            {!detail.report.enforcement_action && <button className="danger-button" type="button" onClick={() => requestAction('reject_content', 'Reject content', detail.report.subject_type === 'menu_import' ? 'Close this failed import as rejected.' : 'Reject and hide this content from customers.', true)}>Reject</button>}
            {['hidden', 'rejected'].includes(detail.report.enforcement_action || '') && <button className="admin-primary-button" type="button" onClick={() => requestAction('restore_content', 'Restore content', 'Restore the content state captured before moderation.')}>Restore</button>}
            {!['actioned', 'dismissed'].includes(detail.report.status) && <button className="secondary-button" type="button" onClick={() => requestAction('resolve', 'Resolve report', 'Close the investigation without changing the current content state.')}>Resolve</button>}
            {!['actioned', 'dismissed'].includes(detail.report.status) && <button className="secondary-button" type="button" onClick={() => requestAction('dismiss', 'Dismiss report', 'Close this report as not requiring moderation action.')}>Dismiss</button>}
          </div>}

          <section className="moderation-history"><h3>Moderation history</h3>{detail.activity.map((activity) => <article key={activity.id}><span className="timeline-dot" /><div><strong>{humanise(activity.event_type)}</strong><small>{activity.actor_name}</small>{activity.note && <p>{activity.note}</p>}</div><time>{formatDate(activity.created_at)}</time></article>)}</section>
        </>}
      </section>
    </div>

    {showNew && <NewReport onClose={() => setShowNew(false)} onCreated={async (id) => { setShowNew(false); setStatus('open'); setPage(1); setSelected(id); setSuccess('Moderation report created.'); await loadQueue() }} />}
    {pending && <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => { if (!saving) setPending(null) }}><form className="admin-modal moderation-action-modal" role="dialog" aria-modal="true" aria-labelledby="moderation-action-heading" onMouseDown={(event) => event.stopPropagation()} onSubmit={performAction}><div className="modal-heading"><div><span className="admin-kicker">Controlled moderation action</span><h2 id="moderation-action-heading">{pending.title}</h2></div><button type="button" aria-label="Close" disabled={saving} onClick={() => setPending(null)}>×</button></div><p>{pending.description}</p><label>Reason<textarea autoFocus minLength={5} maxLength={500} rows={4} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the permanent audit trail…" /></label><div className="confirmation-buttons"><button className="secondary-button" type="button" disabled={saving} onClick={() => setPending(null)}>Cancel</button><button className={pending.danger ? 'danger-button' : 'admin-primary-button'} type="submit" disabled={saving}>{saving ? 'Saving…' : pending.title}</button></div></form></div>}
  </div>
}

function NewReport({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void | Promise<void> }) {
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<Target[]>([])
  const [target, setTarget] = useState<Target | null>(null)
  const [category, setCategory] = useState(categoryOptions[0])
  const [severity, setSeverity] = useState<Severity>('normal')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (query.trim().length < 2 || target) { setTargets([]); return }
    const timer = window.setTimeout(async () => {
      const { data, error: searchError } = await supabase.rpc('search_platform_moderation_targets', { p_search: query.trim() })
      if (searchError) setError(searchError.message)
      else setTargets(data as Target[])
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, target])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!target || saving) return setError('Choose a restaurant or menu item to report.')
    setSaving(true)
    setError('')
    const { data, error: createError } = await supabase.rpc('create_platform_moderation_report', { p_subject_type: target.subject_type, p_subject_id: target.id, p_category: category, p_severity: severity, p_summary: summary, p_details: details })
    setSaving(false)
    if (createError) return setError(createError.message)
    await onCreated((data as { id: string }).id)
  }

  return <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => { if (!saving) onClose() }}><form className="admin-modal moderation-new-modal" role="dialog" aria-modal="true" aria-labelledby="new-report-heading" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><div className="modal-heading"><div><span className="admin-kicker">New moderation report</span><h2 id="new-report-heading">Report content</h2></div><button type="button" aria-label="Close" disabled={saving} onClick={onClose}>×</button></div>{error && <div className="admin-alert error">{error}</div>}<label>Restaurant or menu item<input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setTarget(null) }} placeholder="Search by restaurant or item name…" required /></label>{targets.length > 0 && <div className="moderation-target-results">{targets.map((option) => <button type="button" key={`${option.subject_type}:${option.id}`} onClick={() => { setTarget(option); setQuery(option.subject_type === 'restaurant' ? option.name : `${option.name} · ${option.restaurant_name}`) }}><strong>{option.name}</strong><small>{humanise(option.subject_type)} · {option.context}</small></button>)}</div>}<div className="moderation-form-grid"><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categoryOptions.map((option) => <option key={option} value={option}>{humanise(option)}</option>)}</select></label><label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)}>{(['low', 'normal', 'high', 'urgent'] as const).map((option) => <option key={option} value={option}>{humanise(option)}</option>)}</select></label></div><label>Summary<input minLength={5} maxLength={160} required value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Short description of the concern" /></label><label>Investigation details<textarea minLength={5} maxLength={4000} rows={5} required value={details} onChange={(event) => setDetails(event.target.value)} /></label><div className="confirmation-buttons"><button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="admin-primary-button" type="submit" disabled={saving || !target}>{saving ? 'Creating…' : 'Create report'}</button></div></form></div>
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article><span className={`metric-dot ${tone}`} /><small>{label}</small><strong>{value}</strong></article>
}

function humanise(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
