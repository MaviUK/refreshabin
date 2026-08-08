import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney } from '../types'

type CustomerSummary = {
  user_id: string
  email: string
  display_name: string
  phone: string | null
  town_city: string | null
  postcode: string | null
  created_at: string
  last_sign_in_at: string | null
  is_suspended: boolean
  order_count: number
  lifetime_spend_pence: number
  last_order_at: string | null
}

type CustomerOrder = {
  id: string
  order_number: number
  restaurant_name: string
  total_pence: number
  order_status: string
  payment_status: string
  created_at: string
}

type CustomerNote = { id: number; note: string; created_at: string; created_by: string }

type CustomerDetail = {
  user_id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  address_line_1: string | null
  address_line_2: string | null
  town_city: string | null
  postcode: string | null
  created_at: string
  last_sign_in_at: string | null
  is_suspended: boolean
  orders: CustomerOrder[]
  notes: CustomerNote[]
}

const blankDetail: CustomerDetail = {
  user_id: '', email: '', first_name: '', last_name: '', phone: '', address_line_1: '',
  address_line_2: '', town_city: '', postcode: '', created_at: '', last_sign_in_at: null,
  is_suspended: false, orders: [], notes: [],
}

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [selected, setSelected] = useState<CustomerDetail | null>(null)
  const [draft, setDraft] = useState<CustomerDetail>(blankDetail)
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadCustomers = useCallback(async (term = '') => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_customers', { p_search: term || null })
    if (loadError) setError(loadError.message)
    else setCustomers((data ?? []) as CustomerSummary[])
    setLoading(false)
  }, [])

  const openCustomer = useCallback(async (userId: string) => {
    setError('')
    const { data, error: detailError } = await supabase.rpc('get_platform_customer', { p_user_id: userId })
    if (detailError) return setError(detailError.message)
    const detail = data as CustomerDetail
    setSelected(detail)
    setDraft(detail)
    setNote('')
    setReason('')
  }, [])

  useEffect(() => { void loadCustomers() }, [loadCustomers])

  async function runSearch(event: FormEvent) {
    event.preventDefault()
    await loadCustomers(search.trim())
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    const { error: saveError } = await supabase.rpc('update_platform_customer_profile', {
      p_user_id: draft.user_id,
      p_first_name: draft.first_name ?? '', p_last_name: draft.last_name ?? '', p_phone: draft.phone ?? '',
      p_address_line_1: draft.address_line_1 ?? '', p_address_line_2: draft.address_line_2 ?? '',
      p_town_city: draft.town_city ?? '', p_postcode: draft.postcode ?? '',
    })
    if (saveError) setError(saveError.message)
    else { setMessage('Customer profile updated.'); await openCustomer(draft.user_id); await loadCustomers(search) }
    setSaving(false)
  }

  async function toggleSuspension() {
    if (!selected) return
    if (!selected.is_suspended && !reason.trim()) return setError('Enter a reason before suspending this customer.')
    setSaving(true); setError(''); setMessage('')
    const { error: actionError } = await supabase.rpc('set_platform_customer_suspension', {
      p_user_id: selected.user_id, p_suspended: !selected.is_suspended, p_reason: reason.trim() || null,
    })
    if (actionError) setError(actionError.message)
    else { setMessage(selected.is_suspended ? 'Customer reactivated.' : 'Customer suspended.'); await openCustomer(selected.user_id); await loadCustomers(search) }
    setSaving(false)
  }

  async function addNote(event: FormEvent) {
    event.preventDefault()
    if (!selected || !note.trim()) return
    setSaving(true); setError(''); setMessage('')
    const { error: noteError } = await supabase.rpc('add_platform_customer_note', { p_user_id: selected.user_id, p_note: note.trim() })
    if (noteError) setError(noteError.message)
    else { setMessage('Internal note added.'); setNote(''); await openCustomer(selected.user_id) }
    setSaving(false)
  }

  return (
    <section className="admin-page">
      <header className="admin-page-header">
        <div><span className="admin-kicker">Customer operations</span><h1>Customers</h1><p>Search accounts, review orders, edit profile details and control access.</p></div>
      </header>

      {error && <div className="admin-alert error">{error}</div>}
      {message && <div className="admin-alert success">{message}</div>}

      <form className="admin-toolbar" onSubmit={runSearch}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone" />
        <button type="submit">Search</button>
      </form>

      <div className="admin-split-layout">
        <div className="admin-panel">
          <div className="admin-panel-heading"><h2>Customer accounts</h2><span>{customers.length}</span></div>
          {loading ? <p>Loading customers…</p> : customers.length === 0 ? <p>No customers found.</p> : (
            <div className="admin-list">
              {customers.map((customer) => (
                <button key={customer.user_id} type="button" className={`admin-list-row ${selected?.user_id === customer.user_id ? 'active' : ''}`} onClick={() => void openCustomer(customer.user_id)}>
                  <span><strong>{customer.display_name}</strong><small>{customer.email}</small></span>
                  <span><strong>{formatMoney(customer.lifetime_spend_pence)}</strong><small>{customer.order_count} orders</small></span>
                  <span className={`status-pill ${customer.is_suspended ? 'suspended' : 'active'}`}>{customer.is_suspended ? 'Suspended' : 'Active'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="admin-panel">
          {!selected ? <div className="admin-empty-state"><h2>Select a customer</h2><p>Open an account to view and edit its details.</p></div> : (
            <>
              <div className="admin-panel-heading"><div><h2>{selected.first_name || selected.last_name ? `${selected.first_name ?? ''} ${selected.last_name ?? ''}`.trim() : selected.email}</h2><small>{selected.email}</small></div><span className={`status-pill ${selected.is_suspended ? 'suspended' : 'active'}`}>{selected.is_suspended ? 'Suspended' : 'Active'}</span></div>

              <div className="admin-detail-grid">
                <span><small>Joined</small><strong>{formatDate(selected.created_at)}</strong></span>
                <span><small>Last sign-in</small><strong>{formatDate(selected.last_sign_in_at)}</strong></span>
                <span><small>Orders</small><strong>{selected.orders.length}</strong></span>
                <span><small>Lifetime spend</small><strong>{formatMoney(selected.orders.reduce((sum, order) => sum + order.total_pence, 0))}</strong></span>
              </div>

              <form className="admin-form-grid" onSubmit={saveProfile}>
                {(['first_name','last_name','phone','address_line_1','address_line_2','town_city','postcode'] as const).map((field) => (
                  <label key={field}><span>{field.replaceAll('_', ' ')}</span><input value={draft[field] ?? ''} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} /></label>
                ))}
                <div className="admin-form-actions"><button type="submit" disabled={saving}>Save profile</button></div>
              </form>

              <div className="admin-danger-zone">
                <h3>Account access</h3>
                {!selected.is_suspended && <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for suspension" />}
                <button type="button" onClick={() => void toggleSuspension()} disabled={saving}>{selected.is_suspended ? 'Reactivate customer' : 'Suspend customer'}</button>
              </div>

              <div className="admin-subsection"><h3>Order history</h3>{selected.orders.length === 0 ? <p>No linked orders.</p> : selected.orders.map((order) => <div className="admin-list-row" key={order.id}><span><strong>#{order.order_number} · {order.restaurant_name}</strong><small>{formatDate(order.created_at)}</small></span><span><strong>{formatMoney(order.total_pence)}</strong><small>{order.order_status} · {order.payment_status}</small></span></div>)}</div>

              <form className="admin-subsection" onSubmit={addNote}><h3>Internal notes</h3><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note visible only to platform admins" /><button type="submit" disabled={saving || !note.trim()}>Add note</button>{selected.notes.map((entry) => <div className="admin-note" key={entry.id}><p>{entry.note}</p><small>{entry.created_by} · {formatDate(entry.created_at)}</small></div>)}</form>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
