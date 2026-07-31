import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Ingredient = {
  id: string
  name: string
  is_included: boolean
  is_removable: boolean
  sort_order: number
}

type Extra = {
  id: string
  name: string
  price_pence: number
  is_available: boolean
  max_quantity: number
  sort_order: number
}

type MenuItem = {
  id: string
  name: string
  description: string | null
  price_pence: number
  is_available: boolean
  is_vegetarian: boolean
  is_vegan: boolean
  sort_order: number
  menu_item_ingredients: Ingredient[]
  menu_item_extras: Extra[]
}

type MenuCategory = {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
  menu_items: MenuItem[]
}

type DraftExtra = {
  name: string
  price: string
  maxQuantity: string
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export default function MenuBuilder() {
  const navigate = useNavigate()
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [restaurantName, setRestaurantName] = useState('Your restaurant')
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [latestSnapshotId, setLatestSnapshotId] = useState<string | null>(null)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [itemName, setItemName] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [isVegetarian, setIsVegetarian] = useState(false)
  const [isVegan, setIsVegan] = useState(false)
  const [ingredients, setIngredients] = useState<string[]>([''])
  const [extras, setExtras] = useState<DraftExtra[]>([{ name: '', price: '0', maxQuantity: '1' }])

  const itemCount = useMemo(
    () => categories.reduce((total, category) => total + category.menu_items.length, 0),
    [categories],
  )

  useEffect(() => {
    void loadMenu()
  }, [])

  async function loadMenu() {
    setLoading(true)
    setError('')

    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user

    if (!user) {
      setError('Your session has expired. Please sign in again.')
      setLoading(false)
      return
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, restaurants(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (membershipError) {
      setError(membershipError.message)
      setLoading(false)
      return
    }

    if (!membership) {
      setLoading(false)
      return
    }

    const id = membership.restaurant_id as string
    const restaurant = membership.restaurants as { name?: string } | null
    setRestaurantId(id)
    setRestaurantName(restaurant?.name || 'Your restaurant')

    const { data: latestSnapshot } = await supabase.from('menu_snapshots').select('id').eq('restaurant_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    setLatestSnapshotId(latestSnapshot?.id || null)

    const { data, error: menuError } = await supabase
      .from('menu_categories')
      .select(`
        id, name, description, sort_order, is_active,
        menu_items(
          id, name, description, price_pence, is_available, is_vegetarian, is_vegan, sort_order,
          menu_item_ingredients(id, name, is_included, is_removable, sort_order),
          menu_item_extras(id, name, price_pence, is_available, max_quantity, sort_order)
        )
      `)
      .eq('restaurant_id', id)
      .order('sort_order', { ascending: true })
      .order('sort_order', { referencedTable: 'menu_items', ascending: true })

    if (menuError) {
      setError(menuError.message)
    } else {
      const menu = (data || []) as MenuCategory[]
      menu.forEach((category) => {
        category.menu_items.forEach((item) => {
          item.menu_item_ingredients = [...(item.menu_item_ingredients || [])].sort((a, b) => a.sort_order - b.sort_order)
          item.menu_item_extras = [...(item.menu_item_extras || [])].sort((a, b) => a.sort_order - b.sort_order)
        })
      })
      setCategories(menu)
      setActiveCategoryId(menu[0]?.id || null)
    }

    setLoading(false)
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault()
    if (!restaurantId || !categoryName.trim()) return

    setSaving(true)
    setError('')

    const { data, error: insertError } = await supabase
      .from('menu_categories')
      .insert({ restaurant_id: restaurantId, name: categoryName.trim(), sort_order: categories.length })
      .select('id, name, description, sort_order, is_active')
      .single()

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    const category: MenuCategory = { ...data, menu_items: [] }
    setCategories((current) => [...current, category])
    setActiveCategoryId(category.id)
    setCategoryName('')
  }

  function startEditingCategory(category: MenuCategory) {
    setEditingCategoryId(category.id)
    setEditingCategoryName(category.name)
  }

  async function saveCategoryName(categoryId: string) {
    const name = editingCategoryName.trim()
    if (!name) return setError('Enter a category name.')
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase.from('menu_categories').update({ name, updated_at: new Date().toISOString() }).eq('id', categoryId)
    setSaving(false)
    if (updateError) return setError(updateError.message)
    setCategories((current) => current.map((category) => category.id === categoryId ? { ...category, name } : category))
    setEditingCategoryId(null)
    setEditingCategoryName('')
  }

  async function deleteCategory(category: MenuCategory) {
    const warning = category.menu_items.length
      ? `Delete "${category.name}" and its ${category.menu_items.length} product${category.menu_items.length === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete the empty category "${category.name}"?`
    if (!window.confirm(warning)) return
    setSaving(true)
    setError('')
    const { error: deleteError } = await supabase.from('menu_categories').delete().eq('id', category.id)
    setSaving(false)
    if (deleteError) return setError(deleteError.message)
    const remaining = categories.filter((entry) => entry.id !== category.id)
    setCategories(remaining)
    if (activeCategoryId === category.id) setActiveCategoryId(remaining[0]?.id || null)
    if (editingCategoryId === category.id) setEditingCategoryId(null)
  }

  async function moveCategory(categoryId: string, direction: -1 | 1) {
    const index = categories.findIndex((category) => category.id === categoryId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= categories.length) return
    const reordered = [...categories]
    ;[reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!]
    const normalized = reordered.map((category, sortOrder) => ({ ...category, sort_order: sortOrder }))
    setCategories(normalized)
    setSaving(true)
    const results = await Promise.all(normalized.map((category) => supabase.from('menu_categories').update({ sort_order: category.sort_order }).eq('id', category.id)))
    setSaving(false)
    const failed = results.find((result) => result.error)
    if (failed?.error) { setError(failed.error.message); await loadMenu() }
  }

  async function moveItem(categoryId: string, itemId: string, direction: -1 | 1) {
    const category = categories.find((entry) => entry.id === categoryId)
    if (!category) return
    const index = category.menu_items.findIndex((item) => item.id === itemId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= category.menu_items.length) return
    const reordered = [...category.menu_items]
    ;[reordered[index], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[index]!]
    const normalized = reordered.map((item, sortOrder) => ({ ...item, sort_order: sortOrder }))
    setCategories((current) => current.map((entry) => entry.id === categoryId ? { ...entry, menu_items: normalized } : entry))
    setSaving(true)
    const results = await Promise.all(normalized.map((item) => supabase.from('menu_items').update({ sort_order: item.sort_order }).eq('id', item.id)))
    setSaving(false)
    const failed = results.find((result) => result.error)
    if (failed?.error) { setError(failed.error.message); await loadMenu() }
  }

  async function replaceEntireMenu() {
    if (!restaurantId) return
    if (!window.confirm('Delete the entire current menu and start a new PDF import? All categories, products, extras and choices will be removed. Existing order history will remain.')) return
    setSaving(true)
    setError('')
    const { data: resetResult, error: resetError } = await supabase.rpc('reset_restaurant_menu', { p_restaurant_id: restaurantId })
    setSaving(false)
    if (resetError) return setError(resetError.message)
    const snapshotId = (resetResult as { snapshot_id?: string } | null)?.snapshot_id
    if (snapshotId) window.sessionStorage.setItem('ordered.menuSnapshotId', snapshotId)
    navigate('/onboarding?menu-reupload=1')
  }

  async function restoreLatestMenu() {
    if (!latestSnapshotId || !window.confirm('Restore the most recent saved menu? Your current menu will be replaced, and a safety copy of it will be kept.')) return
    setSaving(true)
    setError('')
    const { error: restoreError } = await supabase.rpc('restore_restaurant_menu_snapshot', { p_snapshot_id: latestSnapshotId })
    setSaving(false)
    if (restoreError) return setError(restoreError.message)
    await loadMenu()
  }

  function updateIngredient(index: number, value: string) {
    setIngredients((current) => current.map((ingredient, itemIndex) => itemIndex === index ? value : ingredient))
  }

  function updateExtra(index: number, patch: Partial<DraftExtra>) {
    setExtras((current) => current.map((extra, itemIndex) => itemIndex === index ? { ...extra, ...patch } : extra))
  }

  async function addItem(event: FormEvent) {
    event.preventDefault()
    if (!restaurantId || !activeCategoryId || !itemName.trim()) return

    const price = Number.parseFloat(itemPrice)
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a valid item price, for example 6.50.')
      return
    }

    const preparedExtras = extras
      .map((extra) => ({
        name: extra.name.trim(),
        price: Number.parseFloat(extra.price || '0'),
        maxQuantity: Number.parseInt(extra.maxQuantity || '1', 10),
      }))
      .filter((extra) => extra.name)

    if (preparedExtras.some((extra) => !Number.isFinite(extra.price) || extra.price < 0)) {
      setError('Every extra must have a valid price. Use 0 for a free extra.')
      return
    }

    const category = categories.find((entry) => entry.id === activeCategoryId)
    setSaving(true)
    setError('')

    const { data: createdItem, error: insertError } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id: restaurantId,
        category_id: activeCategoryId,
        name: itemName.trim(),
        description: itemDescription.trim() || null,
        price_pence: Math.round(price * 100),
        is_vegetarian: isVegetarian || isVegan,
        is_vegan: isVegan,
        sort_order: category?.menu_items.length || 0,
      })
      .select('id, name, description, price_pence, is_available, is_vegetarian, is_vegan, sort_order')
      .single()

    if (insertError || !createdItem) {
      setSaving(false)
      setError(insertError?.message || 'Unable to create this product.')
      return
    }

    const ingredientRows = ingredients
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name, index) => ({
        restaurant_id: restaurantId,
        menu_item_id: createdItem.id,
        name,
        is_included: true,
        is_removable: true,
        sort_order: index,
      }))

    const extraRows = preparedExtras.map((extra, index) => ({
      restaurant_id: restaurantId,
      menu_item_id: createdItem.id,
      name: extra.name,
      price_pence: Math.round(extra.price * 100),
      is_available: true,
      max_quantity: Math.max(1, Math.min(extra.maxQuantity || 1, 20)),
      sort_order: index,
    }))

    const [ingredientResult, extraResult] = await Promise.all([
      ingredientRows.length
        ? supabase.from('menu_item_ingredients').insert(ingredientRows).select('id, name, is_included, is_removable, sort_order')
        : Promise.resolve({ data: [], error: null }),
      extraRows.length
        ? supabase.from('menu_item_extras').insert(extraRows).select('id, name, price_pence, is_available, max_quantity, sort_order')
        : Promise.resolve({ data: [], error: null }),
    ])

    setSaving(false)

    if (ingredientResult.error || extraResult.error) {
      setError(ingredientResult.error?.message || extraResult.error?.message || 'The product was created, but its customisations could not be saved.')
      await loadMenu()
      return
    }

    const item: MenuItem = {
      ...createdItem,
      menu_item_ingredients: (ingredientResult.data || []) as Ingredient[],
      menu_item_extras: (extraResult.data || []) as Extra[],
    }

    setCategories((current) => current.map((entry) => (
      entry.id === activeCategoryId ? { ...entry, menu_items: [...entry.menu_items, item] } : entry
    )))

    setItemName('')
    setItemDescription('')
    setItemPrice('')
    setIsVegetarian(false)
    setIsVegan(false)
    setIngredients([''])
    setExtras([{ name: '', price: '0', maxQuantity: '1' }])
  }

  async function toggleAvailability(item: MenuItem) {
    const { error: updateError } = await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setCategories((current) => current.map((category) => ({
      ...category,
      menu_items: category.menu_items.map((entry) => entry.id === item.id ? { ...entry, is_available: !entry.is_available } : entry),
    })))
  }

  async function deleteItem(itemId: string) {
    const { error: deleteError } = await supabase.from('menu_items').delete().eq('id', itemId)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setCategories((current) => current.map((category) => ({
      ...category,
      menu_items: category.menu_items.filter((item) => item.id !== itemId),
    })))
  }

  if (loading) return <main className="menu-shell"><div className="menu-state-card">Loading your menu…</div></main>

  if (!restaurantId) {
    return (
      <main className="menu-shell"><div className="menu-state-card"><span className="eyebrow">Menu builder</span><h1>Create your restaurant first.</h1><p>Complete restaurant setup before adding products.</p><Link className="primary-button button-link" to="/onboarding">Start setup</Link></div></main>
    )
  }

  return (
    <main className="menu-shell">
      <header className="menu-header">
        <div><Link className="brand" to="/dashboard">ordered.food</Link><p className="dashboard-kicker">{restaurantName} · Menu builder</p></div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="menu-title-row">
        <div><span className="eyebrow">Build your menu</span><h1>Products, ingredients and extras</h1><p>{categories.length} categories · {itemCount} products</p></div>
        <div className="menu-title-actions">
          {latestSnapshotId && <button className="secondary-button" type="button" onClick={() => void restoreLatestMenu()} disabled={saving}>Restore previous menu</button>}
          <button className="danger-outline-button" type="button" onClick={() => void replaceEntireMenu()} disabled={saving || !categories.length}>Delete menu &amp; reupload PDF</button>
        </div>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="menu-builder-grid">
        <aside className="menu-editor-panel">
          <div className="menu-panel-heading"><div><span className="eyebrow">Categories</span><h2>Menu sections</h2></div></div>
          <form className="inline-create-form" onSubmit={addCategory}>
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Burgers" aria-label="Category name" />
            <button className="primary-button" type="submit" disabled={saving || !categoryName.trim()}>Add</button>
          </form>

          <div className="category-list">
            {categories.map((category) => (
              <div className={activeCategoryId === category.id ? 'category-row active' : 'category-row'} key={category.id}>
                {editingCategoryId === category.id ? (
                  <form className="category-edit-form" onSubmit={(event) => { event.preventDefault(); void saveCategoryName(category.id) }}>
                    <input autoFocus value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} aria-label="Category name" />
                    <button type="submit" disabled={saving || !editingCategoryName.trim()}>Save</button>
                    <button type="button" onClick={() => setEditingCategoryId(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <button className="category-select-button" type="button" onClick={() => setActiveCategoryId(category.id)}><span>{category.name}</span><small>{category.menu_items.length}</small></button>
                    <div className="category-row-actions">
                      <button type="button" onClick={() => void moveCategory(category.id, -1)} disabled={saving || category === categories[0]} aria-label={`Move ${category.name} up`}>↑</button>
                      <button type="button" onClick={() => void moveCategory(category.id, 1)} disabled={saving || category === categories[categories.length - 1]} aria-label={`Move ${category.name} down`}>↓</button>
                      <button type="button" onClick={() => startEditingCategory(category)} aria-label={`Edit ${category.name}`}>Edit</button>
                      <button className="danger-text-button" type="button" onClick={() => void deleteCategory(category)} aria-label={`Delete ${category.name}`}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {!categories.length && <p className="empty-copy">Add your first category to begin.</p>}
          </div>

          {activeCategoryId && (
            <form className="product-form" onSubmit={addItem}>
              <div className="menu-panel-heading compact"><div><span className="eyebrow">New product</span><h2>Add an item</h2></div></div>
              <label>Product name<input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Cheeseburger" required /></label>
              <label>Description<textarea value={itemDescription} onChange={(event) => setItemDescription(event.target.value)} placeholder="A short customer-facing description" rows={2} /></label>
              <label>Base price<div className="price-field"><span>£</span><input inputMode="decimal" value={itemPrice} onChange={(event) => setItemPrice(event.target.value)} placeholder="6.50" required /></div></label>

              <fieldset>
                <legend>Included ingredients</legend>
                <p className="empty-copy">Customers can remove these from their order.</p>
                {ingredients.map((ingredient, index) => (
                  <div className="inline-create-form" key={`ingredient-${index}`}>
                    <input value={ingredient} onChange={(event) => updateIngredient(index, event.target.value)} placeholder={index === 0 ? 'Bun' : 'Patty, cheese, lettuce…'} />
                    {ingredients.length > 1 && <button type="button" onClick={() => setIngredients((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}
                  </div>
                ))}
                <button className="secondary-button" type="button" onClick={() => setIngredients((current) => [...current, ''])}>+ Add ingredient</button>
              </fieldset>

              <fieldset>
                <legend>Optional extras</legend>
                <p className="empty-copy">Use £0.00 for a free extra.</p>
                {extras.map((extra, index) => (
                  <div className="product-form" key={`extra-${index}`}>
                    <label>Extra name<input value={extra.name} onChange={(event) => updateExtra(index, { name: event.target.value })} placeholder="Bacon" /></label>
                    <label>Additional price<div className="price-field"><span>£</span><input inputMode="decimal" value={extra.price} onChange={(event) => updateExtra(index, { price: event.target.value })} placeholder="1.00" /></div></label>
                    <label>Maximum quantity<input type="number" min="1" max="20" value={extra.maxQuantity} onChange={(event) => updateExtra(index, { maxQuantity: event.target.value })} /></label>
                    {extras.length > 1 && <button className="text-button" type="button" onClick={() => setExtras((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove extra</button>}
                  </div>
                ))}
                <button className="secondary-button" type="button" onClick={() => setExtras((current) => [...current, { name: '', price: '0', maxQuantity: '1' }])}>+ Add extra</button>
              </fieldset>

              <div className="dietary-options">
                <label><input type="checkbox" checked={isVegetarian} onChange={(event) => setIsVegetarian(event.target.checked)} /> Vegetarian</label>
                <label><input type="checkbox" checked={isVegan} onChange={(event) => { setIsVegan(event.target.checked); if (event.target.checked) setIsVegetarian(true) }} /> Vegan</label>
              </div>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add product'}</button>
            </form>
          )}
        </aside>

        <section className="menu-preview-panel">
          <div className="preview-phone">
            <div className="preview-restaurant-header"><span>Customer preview</span><h2>{restaurantName}</h2><p>Order for collection or delivery</p></div>
            <nav className="preview-category-tabs">{categories.map((category) => <a href={`#category-${category.id}`} key={category.id}>{category.name}</a>)}</nav>
            <div className="preview-menu-content">
              {categories.map((category) => (
                <section id={`category-${category.id}`} className="preview-category" key={category.id}>
                  <h3>{category.name}</h3>
                  <div className="preview-items">
                    {category.menu_items.map((item) => (
                      <article className={item.is_available ? 'preview-item' : 'preview-item unavailable'} key={item.id}>
                        <div>
                          <h4>{item.name}</h4>
                          {item.description && <p>{item.description}</p>}
                          {item.menu_item_ingredients.length > 0 && <p><strong>Includes:</strong> {item.menu_item_ingredients.map((ingredient) => ingredient.name).join(', ')}</p>}
                          {item.menu_item_extras.length > 0 && <p><strong>Extras:</strong> {item.menu_item_extras.map((extra) => `${extra.name}${extra.price_pence ? ` +${money.format(extra.price_pence / 100)}` : ' free'}`).join(', ')}</p>}
                          <div className="dietary-badges">{item.is_vegan && <span>Vegan</span>}{!item.is_vegan && item.is_vegetarian && <span>Vegetarian</span>}{!item.is_available && <span>Unavailable</span>}</div>
                          <strong>{money.format(item.price_pence / 100)}</strong>
                        </div>
                        <div className="item-actions"><button type="button" onClick={() => void moveItem(category.id, item.id, -1)} disabled={saving || item === category.menu_items[0]}>↑ Up</button><button type="button" onClick={() => void moveItem(category.id, item.id, 1)} disabled={saving || item === category.menu_items[category.menu_items.length - 1]}>↓ Down</button><button type="button" onClick={() => toggleAvailability(item)}>{item.is_available ? 'Pause' : 'Enable'}</button><button type="button" onClick={() => deleteItem(item.id)}>Delete</button></div>
                      </article>
                    ))}
                    {!category.menu_items.length && <p className="empty-copy">No products in this category yet.</p>}
                  </div>
                </section>
              ))}
              {!categories.length && <div className="preview-empty"><span>🍽️</span><h3>Your menu preview will appear here.</h3><p>Add a category, then add your first product.</p></div>}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
