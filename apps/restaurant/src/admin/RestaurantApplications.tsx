import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type ApplicationStatus = 'pending_approval' | 'active' | 'rejected'
type Application = {
  id: string
  name: string
  slug: string
  status: ApplicationStatus
  email: string | null
  phone: string | null
  cuisines: string[] | null
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number | null
  delivery_fee_pence: number | null
  delivery_radius_miles: number | null
  logo_url: string | null
  cover_url: string | null
  submitted_at: string | null
  approved_at: string | null
  approval_notes: string | null
  opening_hours_count: number
  menu_category_count: number
  menu_item_count: number
  location: { address_line_1?: string; address_line_2?: string; city?: string; postcode?: string }
}

const statusLabels: Record<ApplicationStatus, string> = {
  pending_approval: 'Pending',
  active: 'Approved',
  rejected: 'Rejected',
}

function money(value: number | null) {
  return value == null ? 'Not set' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100)
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded'
}

export default function RestaurantApplications() {
  const [status, setStatus] = useState<ApplicationStatus>('pending_approval')
  const [applications, setApplications] = useState<Application[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadApplications = useCallback(async (nextStatus: ApplicationStatus) => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_restaurant_applications', { p_status: nextStatus })
    if (loadError) {
      setError(loadError.message)
      setApplications([])
    } else {
      const rows = Array.isArray(data) ? data as Application[] : []
      setApplications(rows)
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadApplications(status) }, [loadApplications, status])

  const selected = applications.find((application) => application.id === selectedId) ?? null

  async function decide(decision: 'approved' | 'rejected') {
    if (!selected) return
    if (decision === 'rejected' && !notes.trim()) {
      setError('Add a clear review note before rejecting the application.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    const { error: decisionError } = await supabase.rpc('review_restaurant_application', {
      p_restaurant_id: selected.id,
      p_decision: decision,
      p_notes: notes.trim() || null,
    })
    if (decisionError) {
      setError(decisionError.message)
    } else {
      setMessage(`${selected.name} has been ${decision === 'approved' ? 'approved and activated' : 'rejected'}.`)
      setNotes('')
      await loadApplications(status)
    }
    setSaving(false)
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><span className="eyebrow">ordered.food admin</span><h1>Restaurant applications</h1><p>Review submitted restaurants before they appear on the platform.</p></div>
        <Link className="text-button" to="/dashboard">Restaurant portal</Link>
      </header>

      <nav className="admin-tabs" aria-label="Application status">
        {(Object.keys(statusLabels) as ApplicationStatus[]).map((value) => (
          <button type="button" className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setMessage('') }} key={value}>{statusLabels[value]}</button>
        ))}
      </nav>

      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="form-success" role="status">{message}</div>}

      <div className="admin-layout">
        <section className="admin-list" aria-label={`${statusLabels[status]} applications`}>
          {loading && <div className="admin-empty">Loading applications…</div>}
          {!loading && applications.length === 0 && <div className="admin-empty"><strong>No {statusLabels[status].toLowerCase()} applications</strong><span>Applications will appear here when their status changes.</span></div>}
          {applications.map((application) => (
            <button type="button" className={selectedId === application.id ? 'admin-list-item active' : 'admin-list-item'} onClick={() => { setSelectedId(application.id); setNotes(application.approval_notes ?? ''); setError(''); setMessage('') }} key={application.id}>
              <span className="admin-list-logo">{application.logo_url ? <img src={application.logo_url} alt="" /> : application.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{application.name}</strong><small>{application.cuisines?.join(' · ') || 'Cuisine not listed'}</small><small>{date(application.submitted_at)}</small></span>
              <span className={`admin-status ${application.status}`}>{statusLabels[application.status]}</span>
            </button>
          ))}
        </section>

        <section className="admin-detail">
          {!selected && !loading && <div className="admin-empty">Select an application to review it.</div>}
          {selected && <>
            {selected.cover_url && <img className="admin-cover" src={selected.cover_url} alt="" />}
            <div className="admin-detail-heading">
              <div><span className={`admin-status ${selected.status}`}>{statusLabels[selected.status]}</span><h2>{selected.name}</h2><p>Submitted {date(selected.submitted_at)}</p></div>
              <a className="text-button" href={`/r/${selected.slug}`} target="_blank" rel="noreferrer">Preview storefront</a>
            </div>

            <div className="admin-summary-grid">
              <article><span>Contact</span><strong>{selected.email || 'No email'}</strong><small>{selected.phone || 'No phone'}</small></article>
              <article><span>Trading address</span><strong>{selected.location.address_line_1 || 'Not supplied'}</strong><small>{[selected.location.address_line_2, selected.location.city, selected.location.postcode].filter(Boolean).join(', ')}</small></article>
              <article><span>Service</span><strong>{[selected.accepts_delivery && 'Delivery', selected.accepts_collection && 'Collection'].filter(Boolean).join(' & ') || 'Not selected'}</strong><small>{money(selected.delivery_fee_pence)} delivery · {selected.delivery_radius_miles ?? '—'} miles</small></article>
              <article><span>Minimum order</span><strong>{money(selected.minimum_order_pence)}</strong><small>{selected.opening_hours_count}/7 opening days saved</small></article>
              <article><span>Menu</span><strong>{selected.menu_item_count} items</strong><small>{selected.menu_category_count} categories</small></article>
              <article><span>Branding</span><strong>{selected.logo_url ? 'Logo added' : 'No logo'}</strong><small>{selected.cover_url ? 'Cover image added' : 'No cover image'}</small></article>
            </div>

            <label className="admin-notes">Review notes<textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Explain anything the restaurant needs to change…" disabled={selected.status !== 'pending_approval'} /></label>
            {selected.status === 'pending_approval' && <div className="admin-actions"><button className="reject-button" type="button" disabled={saving} onClick={() => void decide('rejected')}>{saving ? 'Saving…' : 'Reject application'}</button><button className="primary-button" type="button" disabled={saving} onClick={() => void decide('approved')}>{saving ? 'Saving…' : 'Approve and activate'}</button></div>}
          </>}
        </section>
      </div>
    </main>
  )
}
