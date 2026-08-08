import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate } from '../types'

type RestaurantNote = {
  id: string
  note: string
  created_at: string
  updated_at: string
  author_user_id: string
  author_name: string
  author_email: string | null
}

type RestaurantActivityEntry = {
  id: number
  action: string
  details: Record<string, unknown>
  created_at: string
  actor_user_id: string
  actor_name: string
  actor_email: string | null
}

type RestaurantActivitySnapshot = {
  notes: RestaurantNote[]
  activity: RestaurantActivityEntry[]
}

function actionLabel(action: string) {
  return action
    .replace(/^restaurant_/, '')
    .replaceAll('_', ' ')
    .replace(/^./, (value) => value.toUpperCase())
}

function detailSummary(details: Record<string, unknown>) {
  const reason = typeof details.reason === 'string' ? details.reason : null
  const preview = typeof details.preview === 'string' ? details.preview : null
  const changedFields = Array.isArray(details.changed_fields) ? details.changed_fields.join(', ') : null
  if (reason) return reason
  if (preview) return preview
  if (changedFields) return `Changed: ${changedFields}`
  return ''
}

export default function RestaurantActivity({ restaurantId, canManage }: { restaurantId: string; canManage: boolean }) {
  const [snapshot, setSnapshot] = useState<RestaurantActivitySnapshot>({ notes: [], activity: [] })
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_restaurant_activity', {
      p_restaurant_id: restaurantId,
    })
    if (loadError) {
      setError(loadError.message)
      setSnapshot({ notes: [], activity: [] })
    } else {
      setSnapshot((data ?? { notes: [], activity: [] }) as RestaurantActivitySnapshot)
    }
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { void load() }, [load])

  async function addNote(event: FormEvent) {
    event.preventDefault()
    const cleanNote = note.trim()
    if (!canManage || saving || cleanNote.length < 3) {
      if (cleanNote.length < 3) setError('Enter a note of at least 3 characters.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    const { error: saveError } = await supabase.rpc('add_platform_restaurant_note', {
      p_restaurant_id: restaurantId,
      p_note: cleanNote,
    })
    if (saveError) {
      setError(saveError.message)
    } else {
      setNote('')
      setMessage('Internal note added.')
      await load()
    }
    setSaving(false)
  }

  if (loading) return <div className="panel-empty"><span className="gate-spinner" /><strong>Loading notes and activity…</strong></div>

  return (
    <div className="restaurant-activity-panel">
      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {message && <div className="admin-alert success" role="status">{message}</div>}

      <section className="admin-profile-card">
        <header>
          <div><h4>Internal notes</h4><p>Private operational context for platform administrators. Restaurants cannot see these notes.</p></div>
          <span>{snapshot.notes.length} note{snapshot.notes.length === 1 ? '' : 's'}</span>
        </header>

        {canManage && (
          <form className="restaurant-note-form" onSubmit={(event) => void addNote(event)}>
            <label>
              Add an internal note
              <textarea rows={4} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record a support issue, verification detail, commercial arrangement or follow-up…" />
            </label>
            <div className="confirmation-buttons">
              <small>{note.trim().length}/4000</small>
              <button type="submit" className="admin-primary-button" disabled={saving || note.trim().length < 3}>{saving ? 'Adding…' : 'Add note'}</button>
            </div>
          </form>
        )}

        {!snapshot.notes.length && <div className="panel-empty"><strong>No internal notes</strong><span>Add the first note when there is operational context worth retaining.</span></div>}
        <div className="restaurant-note-list">
          {snapshot.notes.map((entry) => (
            <article className="restaurant-note" key={entry.id}>
              <p>{entry.note}</p>
              <footer><strong>{entry.author_name}</strong><span>{formatDate(entry.created_at)}</span></footer>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-profile-card">
        <header><div><h4>Platform activity</h4><p>Recent administrator actions affecting this restaurant.</p></div><button type="button" className="secondary-button" onClick={() => void load()}>↻ Refresh</button></header>
        {!snapshot.activity.length && <div className="panel-empty"><strong>No recorded activity</strong><span>Administrative changes will appear here.</span></div>}
        <div className="restaurant-activity-list">
          {snapshot.activity.map((entry) => {
            const summary = detailSummary(entry.details || {})
            return (
              <article className="restaurant-activity-entry" key={entry.id}>
                <span className="activity-marker" aria-hidden="true" />
                <div><strong>{actionLabel(entry.action)}</strong>{summary && <p>{summary}</p>}<small>{entry.actor_name} · {formatDate(entry.created_at)}</small></div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
