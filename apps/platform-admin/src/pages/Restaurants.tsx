import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney, hasAdminPermission, statusLabels, type Restaurant, type RestaurantStatus } from '../types'

const filters: Array<{ value: RestaurantStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'active', label: 'Live' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'draft', label: 'Onboarding' },
  { value: 'rejected', label: 'Rejected' },
]

type AdminAction = 'approve' | 'reject' | 'suspend' | 'reactivate'

export default function Restaurants() {
  const { admin } = useAdmin()
  const canManage = hasAdminPermission(admin, 'restaurants:manage')
  const [params, setParams] = useSearchParams()
  const rawStatus = params.get('status')
  const initialStatus = filters.some((entry) => entry.value === rawStatus) ? rawStatus as RestaurantStatus : 'all'
  const [status, setStatus] = useState<RestaurantStatus | 'all'>(initialStatus)
  const [search, setSearch] = useState('')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [selectedId, setSelectedId] = useState(params.get('restaurant'))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [action, setAction] = useState<AdminAction | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_restaurants', {
      p_status: status === 'all' ? null : status,
      p_search: search.trim() || null,
    })
    if (loadError) {
      setError(loadError.message)
      setRestaurants([])
    } else {
      const rows = Array.isArray(data) ? data as Restaurant[] : []
      setRestaurants(rows)
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null)
    }
    setLoading(false)
  }, [search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  const selected = useMemo(() => restaurants.find((restaurant) => restaurant.id === selectedId) ?? null, [restaurants, selectedId])

  function changeStatus(next: RestaurantStatus | 'all') {
    setStatus(next)
    setMessage('')
    const nextParams = new URLSearchParams(params)
    if (next === 'all') nextParams.delete('status')
    else nextParams.set('status', next)
    nextParams.delete('restaurant')
    setParams(nextParams, { replace: true })
  }

  function selectRestaurant(id: string) {
    setSelectedId(id)
    setAction(null)
    setReason('')
    setError('')
    setMessage('')
    const nextParams = new URLSearchParams(params)
    nextParams.set('restaurant', id)
    setParams(nextParams, { replace: true })
  }

  async function confirmAction() {
    if (!selected || !action || !canManage) return
    if ((action === 'reject' || action === 'suspend') && !reason.trim()) {
      setError('Add a clear reason before continuing.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    const { error: actionError } = await supabase.rpc('manage_platform_restaurant', {
      p_restaurant_id: selected.id,
      p_action: action,
      p_reason: reason.trim() || null,
    })
    if (actionError) {
      setError(actionError.message)
    } else {
      setMessage(`${selected.name} has been ${pastTense(action)}.`)
      setAction(null)
      setReason('')
      await load()
    }
    setSaving(false)
  }

  return (
    <div className="admin-page restaurants-page">
      <header className="page-heading"><div><span className="admin-kicker">Restaurant operations</span><h1>Restaurants</h1><p>{canManage ? 'Review applications and control which businesses can trade on ordered.food.' : 'View restaurant applications and operational details in read-only mode.'}</p></div></header>

      <div className="restaurant-toolbar">
        <label className="admin-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email or URL…" /></label>
        <div className="status-filters" aria-label="Filter restaurants">
          {filters.map((filter) => <button type="button" className={status === filter.value ? 'active' : ''} onClick={() => changeStatus(filter.value)} key={filter.value}>{filter.label}</button>)}
        </div>
      </div>

      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {message && <div className="admin-alert success" role="status">{message}</div>}

      <div className="restaurant-workspace">
        <section className="restaurant-list" aria-label="Restaurants">
          <div className="list-heading"><strong>{loading ? 'Loading…' : `${restaurants.length} restaurant${restaurants.length === 1 ? '' : 's'}`}</strong><small>{status === 'all' ? 'All statuses' : statusLabels[status]}</small></div>
          {!loading && restaurants.length === 0 && <div className="panel-empty"><strong>No restaurants found</strong><span>Try a different status or search.</span></div>}
          {restaurants.map((restaurant) => (
            <button type="button" className={`restaurant-list-row ${restaurant.id === selectedId ? 'active' : ''}`} onClick={() => selectRestaurant(restaurant.id)} key={restaurant.id}>
              <span className="restaurant-logo">{restaurant.logo_url ? <img src={restaurant.logo_url} alt="" /> : restaurant.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{restaurant.name}</strong><small>{restaurant.location?.city || restaurant.location?.postcode || restaurant.cuisines?.[0] || 'Location not supplied'}</small></span>
              <span className={`status-badge ${restaurant.status}`}>{statusLabels[restaurant.status]}</span>
            </button>
          ))}
        </section>

        <section className="restaurant-detail">
          {!selected && <div className="panel-empty"><strong>Select a restaurant</strong><span>Its operational details will appear here.</span></div>}
          {selected && <>
            <div className="restaurant-detail-header">
              <div className="restaurant-identity"><span className="restaurant-logo large">{selected.logo_url ? <img src={selected.logo_url} alt="" /> : selected.name.slice(0, 1).toUpperCase()}</span><div><span className={`status-badge ${selected.status}`}>{statusLabels[selected.status]}</span><h2>{selected.name}</h2><p>/{selected.slug} · Joined {formatDate(selected.created_at, false)}</p></div></div>
              <a className="secondary-button" href={`/r/${selected.slug}`} target="_blank" rel="noreferrer">Open storefront ↗</a>
            </div>

            <div className="restaurant-summary">
              <Summary label="Gross paid sales" value={formatMoney(selected.gross_sales_pence)} detail={`${selected.order_count} orders`} />
              <Summary label="Menu" value={`${selected.menu_item_count} items`} detail={`${selected.menu_category_count} categories`} />
              <Summary label="Last order" value={selected.last_order_at ? formatDate(selected.last_order_at, false) : 'No orders'} detail={selected.accepting_orders ? 'Accepting orders enabled' : 'Restaurant paused'} />
            </div>

            <div className="detail-section"><h3>Business details</h3><div className="detail-grid">
              <Detail label="Contact" value={selected.email || 'Not supplied'} detail={selected.phone || undefined} />
              <Detail label="Trading address" value={selected.location?.address_line_1 || 'Not supplied'} detail={[selected.location?.address_line_2, selected.location?.city, selected.location?.postcode].filter(Boolean).join(', ') || undefined} />
              <Detail label="Service" value={[selected.accepts_delivery && 'Delivery', selected.accepts_collection && 'Collection'].filter(Boolean).join(' & ') || 'Not selected'} detail={`${formatMoney(selected.delivery_fee_pence)} delivery · ${formatMoney(selected.minimum_order_pence)} minimum`} />
              <Detail label="Application" value={selected.submitted_at ? `Submitted ${formatDate(selected.submitted_at, false)}` : 'Not submitted'} detail={selected.approved_at ? `Approved ${formatDate(selected.approved_at, false)}` : selected.approval_notes || undefined} />
            </div></div>

            {action && <div className="action-confirmation">
              <div><span className="admin-kicker">Confirm action</span><h3>{actionTitle(action, selected.name)}</h3><p>{actionDescription(action)}</p></div>
              {(action === 'reject' || action === 'suspend') && <label>Reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="This is saved in the audit trail…" /></label>}
              {action === 'approve' && <label>Internal note (optional)<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Anything useful for the audit trail…" /></label>}
              <div className="confirmation-buttons"><button type="button" className="secondary-button" onClick={() => { setAction(null); setReason('') }} disabled={saving}>Cancel</button><button type="button" className={action === 'reject' || action === 'suspend' ? 'danger-button' : 'admin-primary-button'} onClick={() => void confirmAction()} disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</button></div>
            </div>}

            {!canManage && <div className="read-only-notice"><strong>Read-only access</strong><span>Your role can inspect restaurant details but cannot approve, reject, suspend or reactivate them.</span></div>}

            {!action && canManage && <div className="restaurant-actions">
              {selected.status === 'pending_approval' && <><button type="button" className="danger-button ghost" onClick={() => setAction('reject')}>Reject application</button><button type="button" className="admin-primary-button" onClick={() => setAction('approve')}>Approve & make live</button></>}
              {selected.status === 'active' && <button type="button" className="danger-button ghost" onClick={() => setAction('suspend')}>Suspend restaurant</button>}
              {selected.status === 'suspended' && <button type="button" className="admin-primary-button" onClick={() => setAction('reactivate')}>Reactivate restaurant</button>}
            </div>}
          </>}
        </section>
      </div>
    </div>
  )
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>
}

function Detail({ label, value, detail }: { label: string; value: string; detail?: string | undefined }) {
  return <article><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</article>
}

function actionTitle(action: AdminAction, name: string) {
  return ({ approve: `Approve ${name}?`, reject: `Reject ${name}?`, suspend: `Suspend ${name}?`, reactivate: `Reactivate ${name}?` })[action]
}

function actionDescription(action: AdminAction) {
  return ({
    approve: 'The restaurant will immediately become publicly visible and able to take orders.',
    reject: 'The restaurant will remain unavailable and will see the review note.',
    suspend: 'The storefront and checkout will be taken offline. Existing records are preserved.',
    reactivate: 'The storefront will become public again. Its previous accepting-orders setting is preserved.',
  })[action]
}

function pastTense(action: AdminAction) {
  return ({ approve: 'approved and made live', reject: 'rejected', suspend: 'suspended', reactivate: 'reactivated' })[action]
}
