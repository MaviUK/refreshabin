import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type MenuItem = {
  id: string
  name: string
  description: string | null
  price_pence: number
  is_available: boolean
  is_vegetarian: boolean
  is_vegan: boolean
  sort_order: number
}

type MenuCategory = {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
  menu_items: MenuItem[]
}

export default function MenuBuilder() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [restaurantName, setRestaurantName] = useState('Your restaurant')
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [itemName, setItemName] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [itemPrice, setItemPrice] = useState('')
  const [isVegetarian, setIsVegetarian] = useState(false)
  const [isVegan, setIsVegan] = useState(false)

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

    const { data, error: menuError } = await supabase
      .from('menu_categories')
      .select('id, name, description, sort_order, is_active, menu_items(id, name, description, price_pence, is_available, is_vegetarian, is_vegan, sort_order)')
      .eq('restaurant_id', id)
      .order('sort_order', { ascending: true })
      .order('sort_order', { referencedTable: 'menu_items', ascending: true })

    if (menuError) {
      setError(menuError.message)
    } else {
      setCategories((data || []) as MenuCategory[])
      setActiveCategoryId(data?.[0]?.id || null)
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
      .insert({
        restaurant_id: restaurantId,
        name: categoryName.trim(),
        sort_order: categories.length,
      })
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

  async function addItem(event: FormEvent) {
    event.preventDefault()
    if (!restaurantId || !activeCategoryId || !itemName.trim()) return

    const price = Number.parseFloat(itemPrice)
    if (!Number.isFinite(price) || price < 0) {
      setError('Enter a valid price, for example 9.95.')
      return
    }

    const category = categories.find((entry) => entry.id === activeCategoryId)
    setSaving(true)
    setError('')

    const { data, error: insertError } = await supabase
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

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setCategories((current) => current.map((entry) => (
      entry.id === activeCategoryId
        ? { ...entry, menu_items: [...entry.menu_items, data as MenuItem] }
        : entry
    )))
    setItemName('')
    setItemDescription('')
    setItemPrice('')
    setIsVegetarian(false)
    setIsVegan(false)
  }

  async function toggleAvailability(item: MenuItem) {
    const { error: updateError } = await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setCategories((current) => current.map((category) => ({
      ...category,
      menu_items: category.menu_items.map((entry) => (
        entry.id === item.id ? { ...entry, is_available: !entry.is_available } : entry
      )),
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

  if (loading) {
    return <main className="menu-shell"><div className="menu-state-card">Loading your menu…</div></main>
  }

  if (!restaurantId) {
    return (
      <main className="menu-shell">
        <div className="menu-state-card">
          <span className="eyebrow">Menu builder</span>
          <h1>Create your restaurant first.</h1>
          <p>Complete the restaurant setup before adding categories and products.</p>
          <Link className="primary-button button-link" to="/onboarding">Start setup</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="menu-shell">
      <header className="menu-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">{restaurantName} · Menu builder</p>
        </div>
        <Link className="secondary-button button-link" to="/dashboard">Dashboard</Link>
      </header>

      <section className="menu-title-row">
        <div>
          <span className="eyebrow">Build your menu</span>
          <h1>Categories and products</h1>
          <p>{categories.length} categories · {itemCount} products</p>
        </div>
        <button className="ai-import-button" type="button" disabled title="AI import is coming next">✨ Import menu with AI</button>
      </section>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="menu-builder-grid">
        <aside className="menu-editor-panel">
          <div className="menu-panel-heading">
            <div>
              <span className="eyebrow">Categories</span>
              <h2>Menu sections</h2>
            </div>
          </div>

          <form className="inline-create-form" onSubmit={addCategory}>
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Pizzas" aria-label="Category name" />
            <button className="primary-button" type="submit" disabled={saving || !categoryName.trim()}>Add</button>
          </form>

          <div className="category-list">
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                className={activeCategoryId === category.id ? 'category-row active' : 'category-row'}
                onClick={() => setActiveCategoryId(category.id)}
              >
                <span>{category.name}</span>
                <small>{category.menu_items.length}</small>
              </button>
            ))}
            {!categories.length && <p className="empty-copy">Add your first category to begin.</p>}
          </div>

          {activeCategoryId && (
            <form className="product-form" onSubmit={addItem}>
              <div className="menu-panel-heading compact">
                <div>
                  <span className="eyebrow">New product</span>
                  <h2>Add an item</h2>
                </div>
              </div>
              <label>
                Product name
                <input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Margherita Pizza" required />
              </label>
              <label>
                Description
                <textarea value={itemDescription} onChange={(event) => setItemDescription(event.target.value)} placeholder="Tomato, mozzarella and fresh basil" rows={3} />
              </label>
              <label>
                Price
                <div className="price-field"><span>£</span><input inputMode="decimal" value={itemPrice} onChange={(event) => setItemPrice(event.target.value)} placeholder="9.95" required /></div>
              </label>
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
            <div className="preview-restaurant-header">
              <span>Customer preview</span>
              <h2>{restaurantName}</h2>
              <p>Order for collection or delivery</p>
            </div>

            <nav className="preview-category-tabs">
              {categories.map((category) => <a href={`#category-${category.id}`} key={category.id}>{category.name}</a>)}
            </nav>

            <div className="preview-menu-content">
              {categories.map((category) => (
                <section id={`category-${category.id}`} className="preview-category" key={category.id}>
                  <h3>{category.name}</h3>
                  {category.description && <p>{category.description}</p>}
                  <div className="preview-items">
                    {category.menu_items.map((item) => (
                      <article className={item.is_available ? 'preview-item' : 'preview-item unavailable'} key={item.id}>
                        <div>
                          <h4>{item.name}</h4>
                          {item.description && <p>{item.description}</p>}
                          <div className="dietary-badges">
                            {item.is_vegan && <span>Vegan</span>}
                            {!item.is_vegan && item.is_vegetarian && <span>Vegetarian</span>}
                            {!item.is_available && <span>Unavailable</span>}
                          </div>
                          <strong>£{(item.price_pence / 100).toFixed(2)}</strong>
                        </div>
                        <div className="item-actions">
                          <button type="button" onClick={() => toggleAvailability(item)}>{item.is_available ? 'Pause' : 'Enable'}</button>
                          <button type="button" onClick={() => deleteItem(item.id)}>Delete</button>
                        </div>
                      </article>
                    ))}
                    {!category.menu_items.length && <p className="empty-copy">No products in this category yet.</p>}
                  </div>
                </section>
              ))}
              {!categories.length && (
                <div className="preview-empty">
                  <span>🍽️</span>
                  <h3>Your menu preview will appear here.</h3>
                  <p>Add a category, then add your first product.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}
