import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney } from '../types'
import './Customers.css'

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

const fieldLabels: Record<'first_name' | 'last_name' | 'phone' | 'address_line_1' | 'address_line_2' | 'town_city' | 'postcode', string> = {
  first_name: 'First name',
  last_name: 'Last name',
  phone: 'Phone',
  address_line_1: 'Address line 1',
  address_line_2: 'Address line 2',
  town_city: 'Town / city',
  postcode: 'Postcode',
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0] || 'Customer'
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'C'
}

function customerName(customer: CustomerDetail) {
  const name = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
  return name || customer.email || 'Customer'
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [selected, setSelected] = useState<CustomerDetail | null>(null)
  const [draft, setDraft] = useState<CustomerDetail>(blankDetail)
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
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
    setDetailLoading(true)
    setError('')
    const { data, error: detailError } = await supabase.rpc('get_platform_customer', { p_user_id: userId })
    if (detailError) {
      setError(detailError.message)
      setDetailLoading(false)
      return
    }
    const detail = data as CustomerDetail
    setSelected(detail)
    setDraft(detail)
    setNote('')
    setReason('')
    setDetailLoading(false)
  }, [])

  useEffect(() => { void loadCustomers() }, [loadCustomers])

  async function runSearch(event: FormEvent) {
    event.preventDefault()
    await loadCustomers(search.trim())
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!draft.user_id) return
    setSaving(true); setError(''); setMessage('')
    const { error: saveError } = await supabase.rpc('update_platform_customer_profile', {
      p_user_id: draft.user_id,
      p_first_name: draft.first_name ?? '', p_last_name: draft.last_name ?? '', p_phone: draft.phone ?? '',
      p_address_line_1: draft.address_line_1 ?? '', p_address_line_2: draft.address_line_2 ?? '',
      p_town_city: draft.town_city ?? '', p_postcode: draft.postcode ?? '',
    })
    if (saveError) setError(saveError.message)
    else { setMessage('Customer profile updated.'); await openCustomer(draft.user_id); await loadCustomers(search.trim()) }
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
    else { setMessage(selected.is_suspended ? 'Customer reactivated.' : 'Customer suspended.'); await openCustomer(selected.user_id); await loadCustomers(search.trim()) }
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

  const activeCustomers = useMemo(() => customers.filter((customer) => !customer.is_suspended).length, [customers])
  const totalOrders = useMemo(() => customers.reduce((sum, customer) => sum + customer.order_count, 0), [customers])
  const totalSpend = useMemo(() => customers.reduce((sum, customer) => sum + customer.lifetime_spend_pence, 0), [customers])
  const selectedSpend = useMemo(() => selected?.orders.reduce((sum, order) => sum + order.total_pence, 0) ?? 0, [selected])

  return (
    <section className="admin-page customers-page">
      <header className="page-heading customers-heading">
        <div><span className="admin-kicker">Customer operations</span><h1>Customers</h1><p>Search accounts, review orders, edit profile details and control access.</p></div>
        <button type="button" className="secondary-button" onClick={() => void loadCustomers(search.trim())} disabled={loading}>↻ Refresh</button>
      </header>

      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {message && <div className="admin-alert success" role="status">{message}</div>}

      <section className="customer-metric-grid" aria-label="Customer overview">
        <article className="customer-metric"><span>Accounts shown</span><strong>{customers.length}</strong><small>{search.trim() ? 'Matching current search' : 'Up to the latest 250 accounts'}</small></article>
        <article className="customer-metric"><span>Active accounts</span><strong>{activeCustomers}</strong><small>{customers.length - activeCustomers} suspended</small></article>
        <article className="customer-metric"><span>Linked orders</span><strong>{totalOrders}</strong><small>Across accounts shown</small></article>
        <article className="customer-metric"><span>Lifetime spend</span><strong>{formatMoney(totalSpend)}</strong><small>Across accounts shown</small></article>
      </section>

      <form className="customer-toolbar" onSubmit={runSearch}>
        <label className="admin-search customer-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, phone or postcode…" /></label>
        <button type="submit" className="admin-primary-button" disabled={loading}>{loading ? 'Searching…' : 'Search customers'}</button>
        {search && <button type="button" className="clear-filter-button" onClick={() => { setSearch(''); void loadCustomers('') }}>Clear</button>}
      </form>

      <div className="customer-workspace">
        <section className="admin-panel customer-list-panel">
          <div className="panel-heading customer-list-heading"><div><h2>Customer accounts</h2><p>{loading ? 'Loading accounts…' : `${customers.length} account${customers.length === 1 ? '' : 's'} available`}</p></div></div>
          {loading ? <div className="panel-empty customer-loading"><div className="gate-spinner" /><span>Loading customers…</span></div> : customers.length === 0 ? <div className="panel-empty"><strong>No customers found</strong><span>Try a different name, email, phone number or postcode.</span></div> : (
            <div className="customer-list">
              {customers.map((customer) => (
                <button key={customer.user_id} type="button" className={`customer-list-row ${selected?.user_id === customer.user_id ? 'active' : ''}`} onClick={() => void openCustomer(customer.user_id)}>
                  <span className="customer-avatar" aria-hidden="true">{initials(customer.display_name, customer.email)}</span>
                  <span className="customer-primary"><strong>{customer.display_name}</strong><small>{customer.email}</small><small>{[customer.phone, customer.town_city, customer.postcode].filter(Boolean).join(' · ') || 'No contact profile details'}</small></span>
                  <span className="customer-commerce"><strong>{formatMoney(customer.lifetime_spend_pence)}</strong><small>{customer.order_count} order{customer.order_count === 1 ? '' : 's'}</small><small>{customer.last_order_at ? `Last order ${formatDate(customer.last_order_at)}` : 'No orders yet'}</small></span>
                  <span className={`customer-status ${customer.is_suspended ? 'suspended' : 'active'}`}>{customer.is_suspended ? 'Suspended' : 'Active'}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="admin-panel customer-detail-panel">
          {detailLoading ? <div className="panel-empty customer-loading"><div className="gate-spinner" /><span>Loading customer details…</span></div> : !selected ? <div className="customer-empty-detail"><div className="customer-empty-icon" aria-hidden="true">♙</div><h2>Select a customer</h2><p>Open an account to view profile details, order history, internal notes and access controls.</p></div> : (
            <>
              <div className="customer-detail-header">
                <div className="customer-identity"><span className="customer-avatar large" aria-hidden="true">{initials(customerName(selected), selected.email)}</span><div><span className="admin-kicker">Customer profile</span><h2>{customerName(selected)}</h2><p>{selected.email}</p></div></div>
                <span className={`customer-status ${selected.is_suspended ? 'suspended' : 'active'}`}>{selected.is_suspended ? 'Suspended' : 'Active'}</span>
              </div>

              <div className="customer-detail-metrics">
                <article><span>Joined</span><strong>{formatDate(selected.created_at)}</strong></article>
                <article><span>Last sign-in</span><strong>{selected.last_sign_in_at ? formatDate(selected.last_sign_in_at) : 'Never'}</strong></article>
                <article><span>Orders</span><strong>{selected.orders.length}</strong></article>
                <article><span>Lifetime spend</span><strong>{formatMoney(selectedSpend)}</strong></article>
              </div>

              <section className="customer-section">
                <div className="customer-section-heading"><div><h3>Profile details</h3><p>Update the customer information used throughout their account.</p></div></div>
                <form className="customer-profile-form" onSubmit={saveProfile}>
                  {(['first_name','last_name','phone','address_line_1','address_line_2','town_city','postcode'] as const).map((field) => (
                    <label key={field}><span>{fieldLabels[field]}</span><input value={draft[field] ?? ''} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>
                  ))}
                  <div className="customer-form-actions"><button type="submit" className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div>
                </form>
              </section>

              <section className={`customer-access-card ${selected.is_suspended ? 'suspended' : ''}`}>
                <div><span className="customer-access-icon" aria-hidden="true">!</span><div><h3>Account access</h3><p>{selected.is_suspended ? 'This customer is currently blocked from signing in.' : 'Suspending an account blocks customer access until it is reactivated.'}</p></div></div>
                {!selected.is_suspended && <label><span>Reason for suspension</span><textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the platform audit trail…" /></label>}
                <button type="button" className={selected.is_suspended ? 'admin-primary-button' : 'danger-button ghost'} onClick={() => void toggleSuspension()} disabled={saving}>{selected.is_suspended ? 'Reactivate customer' : 'Suspend customer'}</button>
              </section>

              <section className="customer-section">
                <div className="customer-section-heading"><div><h3>Order history</h3><p>{selected.orders.length} linked order{selected.orders.length === 1 ? '' : 's'}.</p></div></div>
                {selected.orders.length === 0 ? <div className="panel-empty compact"><strong>No linked orders</strong><span>This customer has not placed an order with this account.</span></div> : <div className="customer-orders">{selected.orders.map((order) => <article key={order.id}><div><strong>#{order.order_number}</strong><span>{order.restaurant_name}</span><small>{formatDate(order.created_at)}</small></div><div><strong>{formatMoney(order.total_pence)}</strong><span className="customer-order-badges"><small>{statusLabel(order.order_status)}</small><small>{statusLabel(order.payment_status)}</small></span></div></article>)}</div>}
              </section>

              <section className="customer-section">
                <div className="customer-section-heading"><div><h3>Internal notes</h3><p>Private operational notes visible only to platform administrators.</p></div><span>{selected.notes.length}</span></div>
                <form className="customer-note-form" onSubmit={addNote}><textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for support or operations…" /><div><small>{note.length}/4000</small><button type="submit" className="secondary-button" disabled={saving || !note.trim()}>Add note</button></div></form>
                {selected.notes.length === 0 ? <div className="panel-empty compact"><span>No internal notes recorded.</span></div> : <div className="customer-notes">{selected.notes.map((entry) => <article className="customer-note" key={entry.id}><p>{entry.note}</p><small>{entry.created_by} · {formatDate(entry.created_at)}</small></article>)}</div>}
              </section>
            </>
          )}
        </section>
      </div>
    </section>
  )
}
