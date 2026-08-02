import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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

type AdminAction = 'approve' | 'reject' | 'suspend' | 'reactivate' | 'put_offline' | 'put_online'
type DetailTab = 'profile' | 'menu'
type MenuMutation = 'category_create' | 'category_update' | 'category_delete' | 'item_create' | 'item_update' | 'item_delete'

type AdminMenuItem = {
  id: string
  category_id: string
  name: string
  description: string | null
  price_pence: number
  image_url: string | null
  is_available: boolean
  is_vegetarian: boolean
  is_vegan: boolean
  sort_order: number
  updated_at: string
}

type AdminMenuCategory = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
  updated_at: string
  items: AdminMenuItem[]
}

type AdminMenu = {
  restaurant_id: string
  restaurant_name: string
  categories: AdminMenuCategory[]
}

type ItemDraft = {
  id?: string
  categoryId: string
  name: string
  description: string
  price: string
  isVegetarian: boolean
  isVegan: boolean
  reason: string
}

type PendingMenuAction = {
  action: MenuMutation
  targetId: string
  payload: Record<string, unknown>
  title: string
  description: string
}

const emptyItemDraft = (categoryId = ''): ItemDraft => ({
  categoryId,
  name: '',
  description: '',
  price: '',
  isVegetarian: false,
  isVegan: false,
  reason: '',
})

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
  const [tab, setTab] = useState<DetailTab>('profile')
  const [menu, setMenu] = useState<AdminMenu | null>(null)
  const [menuLoading, setMenuLoading] = useState(false)
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

  const loadMenu = useCallback(async (restaurantId: string) => {
    setMenuLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_platform_restaurant_menu', { p_restaurant_id: restaurantId })
    if (loadError) {
      setError(loadError.message)
      setMenu(null)
    } else {
      setMenu(data as AdminMenu)
    }
    setMenuLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  useEffect(() => {
    if (tab === 'menu' && selectedId) void loadMenu(selectedId)
  }, [loadMenu, selectedId, tab])

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
    setTab('profile')
    setMenu(null)
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
    if (action !== 'approve' && !reason.trim()) {
      setError('Add a clear reason before continuing.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    const availabilityChange = action === 'put_offline' || action === 'put_online'
    const result = availabilityChange
      ? await supabase.rpc('set_platform_restaurant_accepting_orders', {
        p_restaurant_id: selected.id,
        p_accepting_orders: action === 'put_online',
        p_reason: reason.trim(),
      })
      : await supabase.rpc('manage_platform_restaurant', {
        p_restaurant_id: selected.id,
        p_action: action,
        p_reason: reason.trim() || null,
      })

    if (result.error) {
      setError(result.error.message)
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
      <header className="page-heading"><div><span className="admin-kicker">Restaurant operations</span><h1>Restaurants</h1><p>{canManage ? 'Open a restaurant profile, control trading availability and manage its menu on the business’s behalf.' : 'View restaurant applications and operational details in read-only mode.'}</p></div></header>

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
          {!selected && <div className="panel-empty"><strong>Select a restaurant</strong><span>Its profile and management controls will appear here.</span></div>}
          {selected && <>
            <div className="restaurant-detail-header">
              <div className="restaurant-identity"><span className="restaurant-logo large">{selected.logo_url ? <img src={selected.logo_url} alt="" /> : selected.name.slice(0, 1).toUpperCase()}</span><div><span className={`status-badge ${selected.status}`}>{statusLabels[selected.status]}</span><h2>{selected.name}</h2><p>/{selected.slug} · Joined {formatDate(selected.created_at, false)}</p></div></div>
              <a className="secondary-button" href={`/r/${selected.slug}`} target="_blank" rel="noreferrer">Open storefront ↗</a>
            </div>

            <div className="restaurant-detail-tabs" role="tablist" aria-label="Restaurant management">
              <button type="button" role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profile & availability</button>
              <button type="button" role="tab" aria-selected={tab === 'menu'} className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>Menu management</button>
            </div>

            {tab === 'profile' && <>
              <div className="restaurant-summary">
                <Summary label="Gross paid sales" value={formatMoney(selected.gross_sales_pence)} detail={`${selected.order_count} orders`} />
                <Summary label="Menu" value={`${selected.menu_item_count} items`} detail={`${selected.menu_category_count} categories`} />
                <Summary label="Order availability" value={selected.status !== 'active' ? 'Unavailable' : selected.accepting_orders ? 'Online' : 'Offline'} detail={selected.last_order_at ? `Last order ${formatDate(selected.last_order_at, false)}` : 'No orders yet'} />
              </div>

              <div className="detail-section"><h3>Business profile</h3><div className="detail-grid">
                <Detail label="Contact" value={selected.email || 'Not supplied'} detail={selected.phone || undefined} />
                <Detail label="Trading address" value={selected.location?.address_line_1 || 'Not supplied'} detail={[selected.location?.address_line_2, selected.location?.city, selected.location?.postcode].filter(Boolean).join(', ') || undefined} />
                <Detail label="Service" value={[selected.accepts_delivery && 'Delivery', selected.accepts_collection && 'Collection'].filter(Boolean).join(' & ') || 'Not selected'} detail={`${formatMoney(selected.delivery_fee_pence)} delivery · ${formatMoney(selected.minimum_order_pence)} minimum`} />
                <Detail label="Application" value={selected.submitted_at ? `Submitted ${formatDate(selected.submitted_at, false)}` : 'Not submitted'} detail={selected.approved_at ? `Approved ${formatDate(selected.approved_at, false)}` : selected.approval_notes || undefined} />
              </div></div>

              <section className={`restaurant-availability-card ${selected.accepting_orders && selected.status === 'active' ? 'online' : 'offline'}`}>
                <div><span className="availability-dot" /><div><span className="admin-kicker">Customer ordering</span><h3>{selected.status !== 'active' ? 'Storefront unavailable' : selected.accepting_orders ? 'Restaurant is online' : 'Restaurant is offline'}</h3><p>{selected.status !== 'active' ? 'Approve or reactivate the restaurant before changing day-to-day order availability.' : selected.accepting_orders ? 'Customers can currently place delivery or collection orders.' : 'The storefront remains visible, but checkout is paused until the restaurant is put online.'}</p></div></div>
                {canManage && selected.status === 'active' && <button type="button" className={selected.accepting_orders ? 'danger-button ghost' : 'admin-primary-button'} onClick={() => setAction(selected.accepting_orders ? 'put_offline' : 'put_online')}>{selected.accepting_orders ? 'Put restaurant offline' : 'Put restaurant online'}</button>}
              </section>

              {action && <ActionConfirmation action={action} restaurantName={selected.name} reason={reason} saving={saving} setReason={setReason} cancel={() => { setAction(null); setReason('') }} confirm={() => void confirmAction()} />}

              {!canManage && <div className="read-only-notice"><strong>Read-only access</strong><span>Your role can inspect restaurant details and menus but cannot change them.</span></div>}

              {!action && canManage && <div className="restaurant-actions">
                {selected.status === 'pending_approval' && <><button type="button" className="danger-button ghost" onClick={() => setAction('reject')}>Reject application</button><button type="button" className="admin-primary-button" onClick={() => setAction('approve')}>Approve & make live</button></>}
                {selected.status === 'active' && <button type="button" className="danger-button ghost" onClick={() => setAction('suspend')}>Suspend restaurant</button>}
                {selected.status === 'suspended' && <button type="button" className="admin-primary-button" onClick={() => setAction('reactivate')}>Reactivate restaurant</button>}
              </div>}
            </>}

            {tab === 'menu' && <MenuManager restaurant={selected} menu={menu} loading={menuLoading} canManage={canManage} reload={() => loadMenu(selected.id)} />}
          </>}
        </section>
      </div>
    </div>
  )
}

function ActionConfirmation({ action, restaurantName, reason, saving, setReason, cancel, confirm }: { action: AdminAction; restaurantName: string; reason: string; saving: boolean; setReason: (value: string) => void; cancel: () => void; confirm: () => void }) {
  return <div className="action-confirmation">
    <div><span className="admin-kicker">Confirm action</span><h3>{actionTitle(action, restaurantName)}</h3><p>{actionDescription(action)}</p></div>
    {action !== 'approve' && <label>Reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="This is required and saved in the audit trail…" /></label>}
    {action === 'approve' && <label>Internal note (optional)<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Anything useful for the audit trail…" /></label>}
    <div className="confirmation-buttons"><button type="button" className="secondary-button" onClick={cancel} disabled={saving}>Cancel</button><button type="button" className={action === 'reject' || action === 'suspend' || action === 'put_offline' ? 'danger-button' : 'admin-primary-button'} onClick={confirm} disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</button></div>
  </div>
}

function MenuManager({ restaurant, menu, loading, canManage, reload }: { restaurant: Restaurant; menu: AdminMenu | null; loading: boolean; canManage: boolean; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryReason, setCategoryReason] = useState('')
  const [editingCategory, setEditingCategory] = useState<AdminMenuCategory | null>(null)
  const [categoryDraft, setCategoryDraft] = useState({ name: '', description: '', reason: '' })
  const [itemDraft, setItemDraft] = useState<ItemDraft>(() => emptyItemDraft())
  const [pending, setPending] = useState<PendingMenuAction | null>(null)
  const [pendingReason, setPendingReason] = useState('')

  useEffect(() => {
    setItemDraft((current) => {
      if (current.id || menu?.categories.some((category) => category.id === current.categoryId)) return current
      return { ...current, categoryId: menu?.categories[0]?.id || '' }
    })
  }, [menu])

  async function mutate(action: MenuMutation, targetId: string | null, payload: Record<string, unknown>, reason: string, success: string) {
    if (!canManage || saving) return false
    if (reason.trim().length < 3) {
      setError('Add a reason of at least 3 characters. Every admin menu change is audited.')
      return false
    }
    setSaving(true)
    setError('')
    setMessage('')
    const { error: mutationError } = await supabase.rpc('manage_platform_restaurant_menu', {
      p_restaurant_id: restaurant.id,
      p_action: action,
      p_target_id: targetId,
      p_payload: payload,
      p_reason: reason.trim(),
    })
    if (mutationError) {
      setError(mutationError.message)
      setSaving(false)
      return false
    }
    await reload()
    setMessage(success)
    setSaving(false)
    return true
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault()
    const ok = await mutate('category_create', null, { name: categoryName }, categoryReason, 'Category added.')
    if (ok) { setCategoryName(''); setCategoryReason('') }
  }

  function startCategoryEdit(category: AdminMenuCategory) {
    setEditingCategory(category)
    setCategoryDraft({ name: category.name, description: category.description || '', reason: '' })
    setError('')
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault()
    if (!editingCategory) return
    const ok = await mutate('category_update', editingCategory.id, { name: categoryDraft.name, description: categoryDraft.description }, categoryDraft.reason, 'Category updated.')
    if (ok) setEditingCategory(null)
  }

  function startItemEdit(item: AdminMenuItem) {
    setItemDraft({ id: item.id, categoryId: item.category_id, name: item.name, description: item.description || '', price: (item.price_pence / 100).toFixed(2), isVegetarian: item.is_vegetarian, isVegan: item.is_vegan, reason: '' })
    setError('')
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault()
    const price = Number.parseFloat(itemDraft.price)
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price, for example 6.50.')
    const action: MenuMutation = itemDraft.id ? 'item_update' : 'item_create'
    const ok = await mutate(action, itemDraft.id || null, {
      category_id: itemDraft.categoryId,
      name: itemDraft.name,
      description: itemDraft.description,
      price_pence: Math.round(price * 100),
      is_vegetarian: itemDraft.isVegetarian || itemDraft.isVegan,
      is_vegan: itemDraft.isVegan,
    }, itemDraft.reason, itemDraft.id ? 'Menu item updated.' : 'Menu item added.')
    if (ok) setItemDraft(emptyItemDraft(menu?.categories[0]?.id || ''))
  }

  async function confirmPending() {
    if (!pending) return
    const ok = await mutate(pending.action, pending.targetId, pending.payload, pendingReason, 'Menu updated.')
    if (ok) { setPending(null); setPendingReason('') }
  }

  if (loading) return <div className="panel-empty menu-admin-loading"><span className="gate-spinner" /><strong>Loading restaurant menu…</strong></div>
  if (!menu) return <div className="panel-empty"><strong>Menu unavailable</strong><span>Refresh the restaurant or try again.</span></div>

  const itemCount = menu.categories.reduce((total, category) => total + category.items.length, 0)

  return <div className="admin-menu-manager">
    <div className="admin-menu-heading"><div><span className="admin-kicker">Manage on behalf of restaurant</span><h3>{menu.restaurant_name} menu</h3><p>{menu.categories.length} categories · {itemCount} items. Changes are immediately reflected on the customer storefront.</p></div><button type="button" className="secondary-button" onClick={() => void reload()} disabled={loading || saving}>↻ Refresh</button></div>

    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {message && <div className="admin-alert success" role="status">{message}</div>}
    {!canManage && <div className="read-only-notice"><strong>Read-only menu</strong><span>Your role can inspect the menu but cannot edit it.</span></div>}

    {canManage && <form className="admin-menu-create-category" onSubmit={(event) => void createCategory(event)}>
      <label>New category<input maxLength={120} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Burgers" required /></label>
      <label>Reason<input maxLength={500} value={categoryReason} onChange={(event) => setCategoryReason(event.target.value)} placeholder="Why are you making this change?" required /></label>
      <button type="submit" className="admin-primary-button" disabled={saving}>Add category</button>
    </form>}

    <div className="admin-menu-categories">
      {menu.categories.map((category) => <article className={`admin-menu-category ${category.is_active ? '' : 'inactive'}`} key={category.id}>
        <header><div><span className={`menu-state ${category.is_active ? 'available' : 'unavailable'}`}>{category.is_active ? 'Visible' : 'Hidden'}</span><h4>{category.name}</h4>{category.description && <p>{category.description}</p>}</div>{canManage && <div className="menu-row-actions"><button type="button" onClick={() => startCategoryEdit(category)}>Edit</button><button type="button" onClick={() => setPending({ action: 'category_update', targetId: category.id, payload: { is_active: !category.is_active }, title: category.is_active ? `Hide ${category.name}?` : `Show ${category.name}?`, description: category.is_active ? 'The whole category and its items will disappear from the storefront.' : 'The category and its available items will return to the storefront.' })}>{category.is_active ? 'Hide' : 'Show'}</button><button type="button" className="danger" onClick={() => setPending({ action: 'category_delete', targetId: category.id, payload: {}, title: `Delete ${category.name}?`, description: `This permanently deletes the category and its ${category.items.length} item${category.items.length === 1 ? '' : 's'}. Existing order history is preserved.` })}>Delete</button></div>}</header>
        <div className="admin-menu-items">
          {category.items.map((item) => <div className={`admin-menu-item ${item.is_available ? '' : 'inactive'}`} key={item.id}>
            <div><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}<span>{formatMoney(item.price_pence)}{item.is_vegan ? ' · Vegan' : item.is_vegetarian ? ' · Vegetarian' : ''}</span></div>
            <span className={`menu-state ${item.is_available ? 'available' : 'unavailable'}`}>{item.is_available ? 'Available' : 'Paused'}</span>
            {canManage && <div className="menu-row-actions"><button type="button" onClick={() => startItemEdit(item)}>Edit</button><button type="button" onClick={() => setPending({ action: 'item_update', targetId: item.id, payload: { is_available: !item.is_available }, title: item.is_available ? `Pause ${item.name}?` : `Enable ${item.name}?`, description: item.is_available ? 'Customers will no longer be able to order this item.' : 'Customers will be able to order this item immediately.' })}>{item.is_available ? 'Pause' : 'Enable'}</button><button type="button" className="danger" onClick={() => setPending({ action: 'item_delete', targetId: item.id, payload: {}, title: `Delete ${item.name}?`, description: 'This permanently removes the item. Existing order history is preserved.' })}>Delete</button></div>}
          </div>)}
          {!category.items.length && <div className="menu-admin-empty">No items in this category.</div>}
        </div>
      </article>)}
      {!menu.categories.length && <div className="panel-empty"><strong>No menu yet</strong><span>Add a category to start building this restaurant’s menu.</span></div>}
    </div>

    {canManage && menu.categories.length > 0 && <form className="admin-menu-item-form" onSubmit={(event) => void saveItem(event)}>
      <div><span className="admin-kicker">{itemDraft.id ? 'Edit menu item' : 'New menu item'}</span><h3>{itemDraft.id ? `Update ${itemDraft.name}` : 'Add an item'}</h3></div>
      <div className="admin-menu-form-grid">
        <label>Category<select value={itemDraft.categoryId} onChange={(event) => setItemDraft({ ...itemDraft, categoryId: event.target.value })}>{menu.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>Item name<input maxLength={160} value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} required /></label>
        <label>Price (£)<input inputMode="decimal" value={itemDraft.price} onChange={(event) => setItemDraft({ ...itemDraft, price: event.target.value })} placeholder="6.50" required /></label>
        <label className="wide">Description<textarea maxLength={1000} rows={2} value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
        <label className="wide">Reason<input maxLength={500} value={itemDraft.reason} onChange={(event) => setItemDraft({ ...itemDraft, reason: event.target.value })} placeholder="Why are you making this change?" required /></label>
      </div>
      <div className="admin-menu-dietary"><label><input type="checkbox" checked={itemDraft.isVegetarian} onChange={(event) => setItemDraft({ ...itemDraft, isVegetarian: event.target.checked })} /> Vegetarian</label><label><input type="checkbox" checked={itemDraft.isVegan} onChange={(event) => setItemDraft({ ...itemDraft, isVegan: event.target.checked, isVegetarian: event.target.checked || itemDraft.isVegetarian })} /> Vegan</label></div>
      <div className="confirmation-buttons">{itemDraft.id && <button type="button" className="secondary-button" onClick={() => setItemDraft(emptyItemDraft(menu.categories[0]?.id || ''))}>Cancel</button>}<button type="submit" className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : itemDraft.id ? 'Save item' : 'Add item'}</button></div>
    </form>}

    {editingCategory && <form className="admin-menu-dialog" onSubmit={(event) => void saveCategory(event)}>
      <div><span className="admin-kicker">Edit category</span><h3>{editingCategory.name}</h3></div>
      <label>Name<input maxLength={120} value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} required /></label>
      <label>Description<textarea maxLength={500} rows={3} value={categoryDraft.description} onChange={(event) => setCategoryDraft({ ...categoryDraft, description: event.target.value })} /></label>
      <label>Reason<input maxLength={500} value={categoryDraft.reason} onChange={(event) => setCategoryDraft({ ...categoryDraft, reason: event.target.value })} required /></label>
      <div className="confirmation-buttons"><button type="button" className="secondary-button" onClick={() => setEditingCategory(null)}>Cancel</button><button type="submit" className="admin-primary-button" disabled={saving}>Save category</button></div>
    </form>}

    {pending && <div className="admin-menu-dialog">
      <div><span className="admin-kicker">Confirm menu change</span><h3>{pending.title}</h3><p>{pending.description}</p></div>
      <label>Reason<textarea maxLength={500} rows={3} value={pendingReason} onChange={(event) => setPendingReason(event.target.value)} placeholder="Required for the audit trail…" required /></label>
      <div className="confirmation-buttons"><button type="button" className="secondary-button" onClick={() => { setPending(null); setPendingReason('') }}>Cancel</button><button type="button" className={pending.action.endsWith('delete') ? 'danger-button' : 'admin-primary-button'} disabled={saving} onClick={() => void confirmPending()}>{saving ? 'Saving…' : 'Confirm'}</button></div>
    </div>}
  </div>
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>
}

function Detail({ label, value, detail }: { label: string; value: string; detail?: string | undefined }) {
  return <article><small>{label}</small><strong>{value}</strong>{detail && <span>{detail}</span>}</article>
}

function actionTitle(action: AdminAction, name: string) {
  return ({ approve: `Approve ${name}?`, reject: `Reject ${name}?`, suspend: `Suspend ${name}?`, reactivate: `Reactivate ${name}?`, put_offline: `Put ${name} offline?`, put_online: `Put ${name} online?` })[action]
}

function actionDescription(action: AdminAction) {
  return ({
    approve: 'The restaurant will immediately become publicly visible and able to take orders.',
    reject: 'The restaurant will remain unavailable and will see the review note.',
    suspend: 'The storefront and checkout will be taken offline. Existing records are preserved.',
    reactivate: 'The storefront will become public again. Its previous accepting-orders setting is preserved.',
    put_offline: 'The storefront remains visible, but checkout is paused until an administrator or the restaurant puts it online again.',
    put_online: 'Customers will immediately be able to place orders using the restaurant’s current delivery and collection settings.',
  })[action]
}

function pastTense(action: AdminAction) {
  return ({ approve: 'approved and made live', reject: 'rejected', suspend: 'suspended', reactivate: 'reactivated', put_offline: 'put offline', put_online: 'put online' })[action]
}
