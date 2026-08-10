import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, hasAdminPermission } from '../types'

type QueueFilter = 'all' | 'overdue' | 'due_soon' | 'unassigned' | 'mine'
type SlaCase = {
  id: string
  case_number: number
  subject: string
  status: string
  priority: string
  category: string
  customer_email: string | null
  restaurant_name: string | null
  order_number: number | null
  assigned_to: string | null
  assigned_to_name: string | null
  response_due_at: string | null
  resolution_due_at: string | null
  first_response_at: string | null
  last_contact_at: string | null
  next_due_at: string | null
  is_overdue: boolean
  updated_at: string
  created_at: string
}
type Snapshot = {
  summary: { overdue: number; due_soon: number; unassigned: number; mine: number }
  cases: SlaCase[]
}

const filters: Array<{ value: QueueFilter; label: string }> = [
  { value: 'all', label: 'All active' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'mine', label: 'My cases' },
]

export default function SupportSla() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'support:manage')
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [search, setSearch] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot>({ summary: { overdue: 0, due_soon: 0, unassigned: 0, mine: 0 }, cases: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [contactType, setContactType] = useState<'customer_contact' | 'restaurant_contact'>('customer_contact')
  const [contactNote, setContactNote] = useState('')
  const [deadlineType, setDeadlineType] = useState<'response_due' | 'resolution_due'>('response_due')
  const [deadline, setDeadline] = useState('')
  const [deadlineNote, setDeadlineNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_support_sla_queue', {
      p_filter: filter,
      p_search: search.trim() || null,
    })
    if (loadError) {
      setError(loadError.message)
      setSnapshot({ summary: { overdue: 0, due_soon: 0, unassigned: 0, mine: 0 }, cases: [] })
    } else {
      const next = data as Snapshot
      setSnapshot(next)
      setSelectedId((current) => next.cases.some((entry) => entry.id === current) ? current : next.cases[0]?.id ?? null)
    }
    setLoading(false)
  }, [filter, search])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  const selected = useMemo(() => snapshot.cases.find((entry) => entry.id === selectedId) ?? null, [selectedId, snapshot.cases])

  async function mutate(action: string, value?: string, note?: string) {
    if (!selected || saving) return
    setSaving(true)
    setError('')
    setMessage('')
    const { error: mutateError } = await supabase.rpc('manage_platform_support_sla', {
      p_case_id: selected.id,
      p_action: action,
      p_value: value || null,
      p_note: note || null,
    })
    if (mutateError) setError(mutateError.message)
    else {
      setMessage('Support case updated.')
      setContactNote('')
      setDeadline('')
      setDeadlineNote('')
      await load()
    }
    setSaving(false)
  }

  function submitContact(event: FormEvent) {
    event.preventDefault()
    void mutate(contactType, undefined, contactNote.trim())
  }

  function submitDeadline(event: FormEvent) {
    event.preventDefault()
    const iso = deadline ? new Date(deadline).toISOString() : ''
    void mutate(deadlineType, iso, deadlineNote.trim())
  }

  return (
    <div className="admin-page support-sla-page">
      <header className="page-heading">
        <div><span className="admin-kicker">Support operations</span><h1>Support SLA</h1><p>Prioritise overdue cases, claim ownership and record customer or restaurant contact.</p></div>
        <Link className="secondary-button" to="/support">Open case manager</Link>
      </header>

      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {message && <div className="admin-alert success" role="status">{message}</div>}

      <section className="support-metrics">
        <article><small>Overdue</small><strong>{snapshot.summary.overdue}</strong></article>
        <article><small>Due within 2 hours</small><strong>{snapshot.summary.due_soon}</strong></article>
        <article><small>Unassigned</small><strong>{snapshot.summary.unassigned}</strong></article>
        <article><small>Assigned to me</small><strong>{snapshot.summary.mine}</strong></article>
      </section>

      <section className="support-toolbar">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Case, order, customer or restaurant…" />
        <div className="status-filters" aria-label="SLA queue filters">
          {filters.map((entry) => <button type="button" key={entry.value} className={filter === entry.value ? 'active' : ''} onClick={() => setFilter(entry.value)}>{entry.label}</button>)}
        </div>
      </section>

      <div className="support-workspace">
        <section className="support-list">
          <div className="list-heading"><strong>{loading ? 'Loading…' : `${snapshot.cases.length} active cases`}</strong><small>Deadline order</small></div>
          {!loading && snapshot.cases.length === 0 && <div className="panel-empty"><strong>No cases found</strong><span>This queue is currently clear.</span></div>}
          {snapshot.cases.map((entry) => (
            <button type="button" key={entry.id} className={`${selectedId === entry.id ? 'active' : ''} ${entry.is_overdue ? 'attention' : ''}`} onClick={() => { setSelectedId(entry.id); setMessage('') }}>
              <span><strong>CASE-{entry.case_number} · {entry.subject}</strong><small>{entry.order_number ? `Order #${entry.order_number} · ` : ''}{entry.restaurant_name || entry.customer_email || 'Unlinked case'}</small></span>
              <span><small className={`case-priority ${entry.priority}`}>{entry.priority}</small><small className={`case-status ${entry.status}`}>{entry.status.replaceAll('_', ' ')}</small></span>
              <time>{entry.is_overdue ? 'Overdue' : entry.next_due_at ? `Due ${formatDate(entry.next_due_at)}` : 'No deadline'}</time>
            </button>
          ))}
        </section>

        <section className="support-detail">
          {!selected && <div className="panel-empty"><strong>Select a case</strong><span>SLA and contact controls will appear here.</span></div>}
          {selected && <>
            <header><div><span className="admin-kicker">CASE-{selected.case_number}</span><h2>{selected.subject}</h2><p>{selected.assigned_to_name ? `Owned by ${selected.assigned_to_name}` : 'This case is unassigned.'}</p></div><span className={`case-status ${selected.status}`}>{selected.status.replaceAll('_', ' ')}</span></header>

            <div className="support-facts">
              <article><small>First response</small><strong>{selected.first_response_at ? formatDate(selected.first_response_at) : 'Not recorded'}</strong></article>
              <article><small>Response deadline</small><strong>{formatDate(selected.response_due_at)}</strong></article>
              <article><small>Resolution deadline</small><strong>{formatDate(selected.resolution_due_at)}</strong></article>
              <article><small>Last contact</small><strong>{formatDate(selected.last_contact_at)}</strong></article>
            </div>

            <div className="support-links">
              <Link to={`/support?search=${selected.case_number}`}>Open full case</Link>
              {selected.order_number && <Link to={`/orders?search=${selected.order_number}`}>Order #{selected.order_number}</Link>}
              {selected.customer_email && <a href={`mailto:${selected.customer_email}`}>{selected.customer_email}</a>}
              {selected.restaurant_name && <span>{selected.restaurant_name}</span>}
            </div>

            {!canManage && <div className="read-only-notice"><strong>Read-only SLA queue</strong><span>Your role can view deadlines but cannot change them.</span></div>}

            {canManage && <>
              {!selected.assigned_to && <button type="button" className="admin-primary-button" disabled={saving} onClick={() => void mutate('claim')}>{saving ? 'Claiming…' : 'Claim this case'}</button>}

              <form className="support-note" onSubmit={submitContact}>
                <h3>Log contact</h3>
                <label>Contacted<select value={contactType} onChange={(event) => setContactType(event.target.value as typeof contactType)}><option value="customer_contact">Customer</option><option value="restaurant_contact">Restaurant</option></select></label>
                <label>Contact summary<textarea required minLength={2} maxLength={4000} rows={3} value={contactNote} onChange={(event) => setContactNote(event.target.value)} placeholder="What was discussed and what happens next?" /></label>
                <button className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Record contact'}</button>
              </form>

              <form className="support-note" onSubmit={submitDeadline}>
                <h3>Adjust SLA deadline</h3>
                <label>Deadline<select value={deadlineType} onChange={(event) => setDeadlineType(event.target.value as typeof deadlineType)}><option value="response_due">First response</option><option value="resolution_due">Resolution</option></select></label>
                <label>New deadline<input type="datetime-local" required value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
                <label>Reason<textarea rows={2} maxLength={1000} value={deadlineNote} onChange={(event) => setDeadlineNote(event.target.value)} placeholder="Why is this deadline being changed?" /></label>
                <button className="secondary-button" disabled={saving}>{saving ? 'Saving…' : 'Update deadline'}</button>
              </form>
            </>}
          </>}
        </section>
      </div>
    </div>
  )
}
