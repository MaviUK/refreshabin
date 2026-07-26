import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type ModifierOption = {
  id: string
  name: string
  price_pence: number
  maximum_quantity: number
  is_available: boolean
  sort_order: number
}

type ModifierGroup = {
  id: string
  name: string
  description: string | null
  selection_type: 'single' | 'multiple'
  minimum_selections: number
  maximum_selections: number | null
  free_selections: number
  is_active: boolean
  sort_order: number
  modifier_options: ModifierOption[]
}

type MenuItem = {
  id: string
  name: string
  category_id: string
}

type Assignment = {
  menu_item_id: string
  modifier_group_id: string
}

type DraftOption = {
  name: string
  price: string
  maximumQuantity: string
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export default function ModifierGroups() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [restaurantName, setRestaurantName] = useState('Your restaurant')
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectionType, setSelectionType] = useState<'single' | 'multiple'>('multiple')
  const [minimumSelections, setMinimumSelections] = useState('0')
  const [maximumSelections, setMaximumSelections] = useState('')
  const [freeSelections, setFreeSelections] = useState('0')
  const [options, setOptions] = useState<DraftOption[]>([{ name: '', price: '0', maximumQuantity: '1' }])

  const activeGroup = groups.find((group) => group.id === activeGroupId) || null
  const activeAssignments = useMemo(
    () => new Set(assignments.filter((assignment) => assignment.modifier_group_id === activeGroupId).map((assignment) => assignment.menu_item_id)),
    [activeGroupId, assignments],
  )

  useEffect(() => { void loadData() }, [])

  async function loadData() {
    setLoading(true)
    setError('')

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      setError('Your session has expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, restaurants(name)')
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (membershipError || !membership) {
      setError(membershipError?.message || 'Create your restaurant before adding modifier groups.')
      setLoading(false)
      return
    }

    const id = membership.restaurant_id as string
    setRestaurantId(id)
    setRestaurantName((membership.restaurants as { name?: string } | null)?.name || 'Your restaurant')

    const [groupResult, itemResult, assignmentResult] = await Promise.all([
      supabase
        .from('modifier_groups')
        .select('id, name, description, selection_type, minimum_selections, maximum_selections, free_selections, is_active, sort_order, modifier_options(id, name, price_pence, maximum_quantity, is_available, sort_order)')
        .eq('restaurant_id', id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('menu_items')
        .select('id, name, category_id')
        .eq('restaurant_id', id)
        .order('name', { ascending: true }),
      supabase
        .from('menu_item_modifier_groups')
        .select('menu_item_id, modifier_group_id')
        .eq('restaurant_id', id),
    ])

    const firstError = groupResult.error || itemResult.error || assignmentResult.error
    if (firstError) {
      setError(firstError.message)
    } else {
      const loadedGroups = (groupResult.data || []) as ModifierGroup[]
      loadedGroups.forEach((group) => {
        group.modifier_options = [...(group.modifier_options || [])].sort((a, b) => a.sort_order - b.sort_order)
      })
      setGroups(loadedGroups)
      setItems((itemResult.data || []) as MenuItem[])
      setAssignments((assignmentResult.data || []) as Assignment[])
      setActiveGroupId((current) => current || loadedGroups[0]?.id || null)
    }

    setLoading(false)
  }

  function updateOption(index: number, patch: Partial<DraftOption>) {
    setOptions((current) => current.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option))
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault()
    if (!restaurantId || !name.trim() || saving) return

    const min = Math.max(0, Number.parseInt(minimumSelections || '0', 10) || 0)
    const max = maximumSelections.trim() ? Math.max(1, Number.parseInt(maximumSelections, 10) || 1) : null
    const free = Math.max(0, Number.parseInt(freeSelections || '0', 10) || 0)

    if (max !== null && max < min) {
      setError('Maximum selections cannot be lower than minimum selections.')
      return
    }

    const preparedOptions = options
      .map((option) => ({
        name: option.name.trim(),
        price: Number.parseFloat(option.price || '0'),
        maximumQuantity: Math.max(1, Math.min(20, Number.parseInt(option.maximumQuantity || '1', 10) || 1)),
      }))
      .filter((option) => option.name)

    if (!preparedOptions.length) {
      setError('Add at least one option to the modifier group.')
      return
    }

    if (preparedOptions.some((option) => !Number.isFinite(option.price) || option.price < 0)) {
      setError('Every option must have a valid price. Use £0.00 for free options.')
      return
    }

    setSaving(true)
    setError('')

    const { data: createdGroup, error: groupError } = await supabase
      .from('modifier_groups')
      .insert({
        restaurant_id: restaurantId,
        name: name.trim(),
        description: description.trim() || null,
        selection_type: selectionType,
        minimum_selections: min,
        maximum_selections: selectionType === 'single' ? 1 : max,
        free_selections: free,
        sort_order: groups.length,
      })
      .select('id, name, description, selection_type, minimum_selections, maximum_selections, free_selections, is_active, sort_order')
      .single()

    if (groupError || !createdGroup) {
      setSaving(false)
      setError(groupError?.message || 'Unable to create this modifier group.')
      return
    }

    const { data: createdOptions, error: optionError } = await supabase
      .from('modifier_options')
      .insert(preparedOptions.map((option, index) => ({
        restaurant_id: restaurantId,
        modifier_group_id: createdGroup.id,
        name: option.name,
        price_pence: Math.round(option.price * 100),
        maximum_quantity: selectionType === 'single' ? 1 : option.maximumQuantity,
        sort_order: index,
      })))
      .select('id, name, price_pence, maximum_quantity, is_available, sort_order')

    setSaving(false)

    if (optionError) {
      setError(optionError.message)
      await loadData()
      return
    }

    const group = { ...createdGroup, modifier_options: (createdOptions || []) as ModifierOption[] } as ModifierGroup
    setGroups((current) => [...current, group])
    setActiveGroupId(group.id)
    setName('')
    setDescription('')
    setSelectionType('multiple')
    setMinimumSelections('0')
    setMaximumSelections('')
    setFreeSelections('0')
    setOptions([{ name: '', price: '0', maximumQuantity: '1' }])
  }

  async function toggleAssignment(menuItemId: string) {
    if (!restaurantId || !activeGroupId) return
    const assigned = activeAssignments.has(menuItemId)

    if (assigned) {
      const { error: deleteError } = await supabase
        .from('menu_item_modifier_groups')
        .delete()
        .eq('menu_item_id', menuItemId)
        .eq('modifier_group_id', activeGroupId)
      if (deleteError) { setError(deleteError.message); return }
      setAssignments((current) => current.filter((assignment) => !(assignment.menu_item_id === menuItemId && assignment.modifier_group_id === activeGroupId)))
      return
    }

    const { error: insertError } = await supabase.from('menu_item_modifier_groups').insert({
      restaurant_id: restaurantId,
      menu_item_id: menuItemId,
      modifier_group_id: activeGroupId,
      sort_order: assignments.filter((assignment) => assignment.menu_item_id === menuItemId).length,
    })
    if (insertError) { setError(insertError.message); return }
    setAssignments((current) => [...current, { menu_item_id: menuItemId, modifier_group_id: activeGroupId }])
  }

  async function toggleGroup(group: ModifierGroup) {
    const { error: updateError } = await supabase.from('modifier_groups').update({ is_active: !group.is_active }).eq('id', group.id)
    if (updateError) { setError(updateError.message); return }
    setGroups((current) => current.map((entry) => entry.id === group.id ? { ...entry, is_active: !entry.is_active } : entry))
  }

  async function deleteGroup(groupId: string) {
    if (!window.confirm('Delete this modifier group? It will be removed from every attached product.')) return
    const { error: deleteError } = await supabase.from('modifier_groups').delete().eq('id', groupId)
    if (deleteError) { setError(deleteError.message); return }
    const remaining = groups.filter((group) => group.id !== groupId)
    setGroups(remaining)
    setAssignments((current) => current.filter((assignment) => assignment.modifier_group_id !== groupId))
    setActiveGroupId(remaining[0]?.id || null)
  }

  if (loading) return <main className="menu-shell"><div className="menu-state-card">Loading modifier groups…</div></main>

  return (
    <main className="menu-shell">
      <header className="menu-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p className="dashboard-kicker">{restaurantName} · Modifier groups</p></div>
        <div style={{ display: 'flex', gap: 10 }}><Link className="secondary-button button-link" to="/menu">Menu</Link><Link className="secondary-button button-link" to="/dashboard">Dashboard</Link></div>
      </header>

      <section className="menu-title-row">
        <div><span className="eyebrow">Reusable customisations</span><h1>Modifier groups</h1><p>Create extras once, then attach them to as many dishes as needed.</p></div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="menu-builder-grid">
        <aside className="menu-editor-panel">
          <form className="product-form" onSubmit={createGroup}>
            <div className="menu-panel-heading compact"><div><span className="eyebrow">New group</span><h2>Create modifier group</h2></div></div>
            <label>Group name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Burger Extras" required /></label>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional extras available on all burgers" rows={2} /></label>
            <label>Selection type<select value={selectionType} onChange={(event) => setSelectionType(event.target.value as 'single' | 'multiple')}><option value="multiple">Multiple choices</option><option value="single">Single choice</option></select></label>
            <div className="two-column">
              <label>Minimum choices<input type="number" min="0" value={minimumSelections} onChange={(event) => setMinimumSelections(event.target.value)} /></label>
              <label>Maximum choices<input type="number" min="1" value={selectionType === 'single' ? '1' : maximumSelections} onChange={(event) => setMaximumSelections(event.target.value)} disabled={selectionType === 'single'} placeholder="No limit" /></label>
            </div>
            <label>Free choices before charging<input type="number" min="0" value={freeSelections} onChange={(event) => setFreeSelections(event.target.value)} /></label>

            <fieldset>
              <legend>Options</legend>
              {options.map((option, index) => (
                <div className="product-form" key={`option-${index}`}>
                  <label>Option name<input value={option.name} onChange={(event) => updateOption(index, { name: event.target.value })} placeholder="Bacon" /></label>
                  <label>Additional price<div className="price-field"><span>£</span><input inputMode="decimal" value={option.price} onChange={(event) => updateOption(index, { price: event.target.value })} placeholder="1.00" /></div></label>
                  {selectionType === 'multiple' && <label>Maximum quantity<input type="number" min="1" max="20" value={option.maximumQuantity} onChange={(event) => updateOption(index, { maximumQuantity: event.target.value })} /></label>}
                  {options.length > 1 && <button className="text-button" type="button" onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}>Remove option</button>}
                </div>
              ))}
              <button className="secondary-button" type="button" onClick={() => setOptions((current) => [...current, { name: '', price: '0', maximumQuantity: '1' }])}>+ Add option</button>
            </fieldset>

            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create modifier group'}</button>
          </form>
        </aside>

        <section className="menu-preview-panel">
          <div className="preview-phone" style={{ maxWidth: 'none' }}>
            <div className="preview-restaurant-header"><span>Modifier library</span><h2>{groups.length} group{groups.length === 1 ? '' : 's'}</h2><p>Select a group, then attach it to products.</p></div>
            <div className="preview-menu-content">
              <div className="category-list">
                {groups.map((group) => (
                  <button type="button" key={group.id} className={activeGroupId === group.id ? 'category-row active' : 'category-row'} onClick={() => setActiveGroupId(group.id)}>
                    <span>{group.name}{!group.is_active ? ' (paused)' : ''}</span><small>{group.modifier_options.length}</small>
                  </button>
                ))}
                {!groups.length && <p className="empty-copy">Create your first reusable modifier group.</p>}
              </div>

              {activeGroup && (
                <section className="preview-category">
                  <h3>{activeGroup.name}</h3>
                  {activeGroup.description && <p>{activeGroup.description}</p>}
                  <p>{activeGroup.selection_type === 'single' ? 'Choose one' : 'Multiple choices'} · Minimum {activeGroup.minimum_selections} · Maximum {activeGroup.maximum_selections ?? 'unlimited'}</p>
                  <div className="preview-items">
                    {activeGroup.modifier_options.map((option) => <article className="preview-item" key={option.id}><div><h4>{option.name}</h4><strong>{option.price_pence ? `+${money.format(option.price_pence / 100)}` : 'Free'}</strong></div></article>)}
                  </div>

                  <div className="menu-panel-heading compact"><div><span className="eyebrow">Attached products</span><h3>Use this group on</h3></div></div>
                  <div className="category-list">
                    {items.map((item) => (
                      <label className="category-row" key={item.id} style={{ cursor: 'pointer' }}>
                        <span><input type="checkbox" checked={activeAssignments.has(item.id)} onChange={() => void toggleAssignment(item.id)} /> {item.name}</span>
                      </label>
                    ))}
                    {!items.length && <p className="empty-copy">Add menu products before attaching this group.</p>}
                  </div>

                  <div className="item-actions" style={{ marginTop: 18 }}>
                    <button type="button" onClick={() => void toggleGroup(activeGroup)}>{activeGroup.is_active ? 'Pause group' : 'Enable group'}</button>
                    <button type="button" onClick={() => void deleteGroup(activeGroup.id)}>Delete group</button>
                  </div>
                </section>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
