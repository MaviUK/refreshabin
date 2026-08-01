import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../types'

type AuditEntry = {
  id: number
  action: string
  target_type: string
  target_id: string | null
  details: Record<string, unknown>
  created_at: string
  actor_name: string
  actor_email: string
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_admin_audit_log', { p_limit: 100 })
    if (loadError) setError(loadError.message)
    else setEntries(Array.isArray(data) ? data as AuditEntry[] : [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="admin-page">
      <header className="page-heading"><div><span className="admin-kicker">Accountability</span><h1>Audit log</h1><p>A permanent record of sensitive platform actions.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>↻ Refresh</button></header>
      {error && <div className="admin-alert error" role="alert">{error}</div>}
      <section className="admin-panel audit-panel">
        {loading && <div className="panel-empty">Loading activity…</div>}
        {!loading && entries.length === 0 && <div className="panel-empty"><strong>No admin actions yet</strong><span>Approvals and status changes will appear here.</span></div>}
        {entries.map((entry) => (
          <article className="audit-row" key={entry.id}>
            <span className="audit-icon">{entry.action.includes('suspend') || entry.action.includes('reject') ? '!' : '✓'}</span>
            <div><strong>{humanise(entry.action)}</strong><p>{describe(entry)}</p><small>{entry.actor_name} · {entry.actor_email}</small></div>
            <time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time>
          </article>
        ))}
      </section>
    </div>
  )
}

function humanise(value: string) {
  return value.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function describe(entry: AuditEntry) {
  const name = typeof entry.details.restaurant_name === 'string' ? entry.details.restaurant_name : entry.target_type
  const reason = typeof entry.details.reason === 'string' ? entry.details.reason : ''
  return reason ? `${name} · ${reason}` : name
}
