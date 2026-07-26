import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Storefront.css'

type Ingredient = {
  id: string
  name: string
  is_included: boolean
  is_removable: boolean
}

type Extra = {
  id: string
  name: string
  price_pence: number
  max_quantity: number
}

type MenuItem = {
  id: string
  name: string
  description: string | null
  price_pence: number
  image_url: string | null
  is_vegetarian: boolean
  is_vegan: boolean
  ingredients: Ingredient[]
  extras: Extra[]
}

type Category = {
  id: string
  name: string
  description: string | null
  items: MenuItem[]
}

type Restaurant = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  cover_url: string | null
  cuisines: string[] | null
  accepts_delivery: boolean
  accepts_collection: boolean
  minimum_order_pence: number | null
  delivery_fee_pence: number | null
  preparation_time_minutes: number | null
  free_delivery_threshold_pence: number | null
}

type StorefrontData = {
  restaurant: Restaurant
  categories: Category[]
}

type SelectedExtra = Extra & { quantity: number }

type BasketLine = MenuItem & {
  line_id: string
  quantity: number
  removed_ingredients: Ingredient[]
  selected_extras: SelectedExtra[]
  special_instructions: string
  unit_price_pence: number
}

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
})

export default function Storefront() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<StorefrontData | null>(null)
  const [basket, setBasket] = useState<Record<string, BasketLine>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [customisingItem, setCustomisingItem] = useState<MenuItem | null>(null)
  const [removedIngredientIds, setRemovedIngredientIds] = useState<string[]>([])
  const [extraQuantities, setExtraQuantities] = useState<Record<string, number>>({})
  const [customQuantity, setCustomQuantity] = useState(1)
  const [specialInstructions, setSpecialInstructions] = useState('')

  useEffect(() => {
    if (!slug) return

    const storageKey = `ordered-food-basket:${slug}`
    const saved = window.localStorage.getItem(storageKey)
    if (saved) {
      try {
        setBasket(JSON.parse(saved))
      } catch {
        window.localStorage.removeItem(storageKey)
      }
    }

    async function loadStorefront() {
      setLoading(true)
      setError('')

      const { data: storefront, error: rpcError } = await supabase.rpc('get_public_storefront', {
        storefront_slug: slug,
      })

      if (rpcError) setError(rpcError.message)
      else if (!storefront) setError('Restaurant not found.')
      else setData(storefront as StorefrontData)

      setLoading(false)
    }

    loadStorefront()
  }, [slug])

  useEffect(() => {
    if (!slug) return
    window.localStorage.setItem(`ordered-food-basket:${slug}`, JSON.stringify(basket))
  }, [basket, slug])

  useEffect(() => {
    document.body.style.overflow = customisingItem ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [customisingItem])

  const filteredCategories = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLowerCase()
    if (!query) return data.categories

    return data.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          `${item.name} ${item.description ?? ''} ${(item.ingredients || []).map((ingredient) => ingredient.name).join(' ')}`.toLowerCase().includes(query),
        ),
      }))
      .filter((category) => category.items.length > 0)
  }, [data, search])

  const basketLines = Object.values(basket)
  const itemCount = basketLines.reduce((total, line) => total + line.quantity, 0)
  const subtotal = basketLines.reduce((total, line) => total + line.unit_price_pence * line.quantity, 0)

  const selectedExtras = customisingItem
    ? customisingItem.extras
      .map((extra) => ({ ...extra, quantity: extraQuantities[extra.id] || 0 }))
      .filter((extra) => extra.quantity > 0)
    : []
  const customUnitPrice = (customisingItem?.price_pence || 0)
    + selectedExtras.reduce((total, extra) => total + extra.price_pence * extra.quantity, 0)
  const customTotal = customUnitPrice * customQuantity

  function openCustomisation(item: MenuItem) {
    setCustomisingItem(item)
    setRemovedIngredientIds([])
    setExtraQuantities({})
    setCustomQuantity(1)
    setSpecialInstructions('')
  }

  function closeCustomisation() {
    setCustomisingItem(null)
  }

  function toggleIngredient(ingredient: Ingredient) {
    if (!ingredient.is_removable) return
    setRemovedIngredientIds((current) => current.includes(ingredient.id)
      ? current.filter((id) => id !== ingredient.id)
      : [...current, ingredient.id])
  }

  function changeExtra(extra: Extra, amount: number) {
    setExtraQuantities((current) => ({
      ...current,
      [extra.id]: Math.max(0, Math.min(extra.max_quantity, (current[extra.id] || 0) + amount)),
    }))
  }

  function addCustomisedItem() {
    if (!customisingItem) return
    const removedIngredients = customisingItem.ingredients.filter((ingredient) => removedIngredientIds.includes(ingredient.id))
    const configurationKey = JSON.stringify({
      item: customisingItem.id,
      removed: removedIngredientIds.slice().sort(),
      extras: selectedExtras.map((extra) => [extra.id, extra.quantity]),
      notes: specialInstructions.trim(),
    })
    const lineId = `${customisingItem.id}:${btoa(unescape(encodeURIComponent(configurationKey))).slice(0, 32)}`

    setBasket((current) => {
      const existing = current[lineId]
      return {
        ...current,
        [lineId]: {
          ...customisingItem,
          line_id: lineId,
          quantity: (existing?.quantity || 0) + customQuantity,
          removed_ingredients: removedIngredients,
          selected_extras: selectedExtras,
          special_instructions: specialInstructions.trim(),
          unit_price_pence: customUnitPrice,
        },
      }
    })
    closeCustomisation()
  }

  function changeQuantity(lineId: string, amount: number) {
    setBasket((current) => {
      const line = current[lineId]
      if (!line) return current
      const quantity = line.quantity + amount
      const next = { ...current }
      if (quantity <= 0) delete next[lineId]
      else next[lineId] = { ...line, quantity }
      return next
    })
  }

  function scrollToCategory(categoryId: string) {
    document.getElementById(`category-${categoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading) return <main className="storefront-state">Loading menu…</main>
  if (error || !data) return <main className="storefront-state"><h1>Unable to load restaurant</h1><p>{error}</p></main>

  const { restaurant } = data
  const deliveryFee = restaurant.accepts_delivery
    && restaurant.delivery_fee_pence
    && (!restaurant.free_delivery_threshold_pence || subtotal < restaurant.free_delivery_threshold_pence)
    ? restaurant.delivery_fee_pence
    : 0
  const total = subtotal + deliveryFee
  const minimumShortfall = Math.max((restaurant.minimum_order_pence ?? 0) - subtotal, 0)
  const canContinue = basketLines.length > 0 && minimumShortfall === 0

  return (
    <main className="storefront-page">
      <section className="storefront-hero">
        {restaurant.cover_url && <img className="storefront-cover" src={restaurant.cover_url} alt="" />}
        <div className="storefront-hero-overlay" />
        <div className="storefront-identity">
          {restaurant.logo_url ? <img className="storefront-logo" src={restaurant.logo_url} alt={`${restaurant.name} logo`} /> : <div className="storefront-logo storefront-logo-fallback">{restaurant.name.slice(0, 1)}</div>}
          <div><span className="storefront-brand">ordered.food</span><h1>{restaurant.name}</h1><p>{restaurant.cuisines?.join(' · ') || 'Freshly prepared food'}</p></div>
        </div>
      </section>

      <section className="storefront-summary">
        <div className="storefront-pills">
          {restaurant.accepts_delivery && <span>Delivery</span>}
          {restaurant.accepts_collection && <span>Collection</span>}
          {restaurant.preparation_time_minutes && <span>{restaurant.preparation_time_minutes} min</span>}
        </div>
        <div className="storefront-fees">
          {restaurant.minimum_order_pence != null && <span>Min. {money.format(restaurant.minimum_order_pence / 100)}</span>}
          {restaurant.delivery_fee_pence != null && <span>Delivery {money.format(restaurant.delivery_fee_pence / 100)}</span>}
          {restaurant.free_delivery_threshold_pence != null && <span>Free over {money.format(restaurant.free_delivery_threshold_pence / 100)}</span>}
        </div>
      </section>

      <nav className="storefront-category-nav" aria-label="Menu categories"><div>{data.categories.map((category) => <button key={category.id} type="button" onClick={() => scrollToCategory(category.id)}>{category.name}</button>)}</div></nav>

      <div className="storefront-layout">
        <section className="storefront-menu">
          <div className="storefront-search-wrap"><input className="storefront-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the menu" aria-label="Search the menu" /></div>
          {!filteredCategories.length && <p className="storefront-empty">No menu items match your search.</p>}

          {filteredCategories.map((category) => (
            <section className="menu-category" id={`category-${category.id}`} key={category.id}>
              <header><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}</header>
              <div className="menu-item-grid">
                {category.items.map((item) => (
                  <article className="menu-item-card" key={item.id} onClick={() => openCustomisation(item)}>
                    <div className="menu-item-copy">
                      <div>
                        <h3>{item.name}</h3>
                        {item.description && <p>{item.description}</p>}
                        {!!item.ingredients?.length && <p className="ingredient-summary">{item.ingredients.map((ingredient) => ingredient.name).join(', ')}</p>}
                        <div className="menu-item-tags">
                          {item.is_vegan && <span>Vegan</span>}
                          {!item.is_vegan && item.is_vegetarian && <span>Vegetarian</span>}
                          {!!item.extras?.length && <span className="customisable-tag">Customisable</span>}
                        </div>
                      </div>
                      <strong>{money.format(item.price_pence / 100)}</strong>
                    </div>
                    <div className="menu-item-action">{item.image_url && <img src={item.image_url} alt={item.name} />}<button type="button" onClick={(event) => { event.stopPropagation(); openCustomisation(item) }} aria-label={`Customise ${item.name}`}>+</button></div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>

        <aside className="basket-panel">
          <div className="basket-heading"><div><span>Your order</span><h2>Basket</h2></div><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span></div>
          {!basketLines.length ? <div className="basket-empty"><div>🛍️</div><h3>Your basket is empty</h3><p>Add something tasty from the menu.</p></div> : (
            <>
              <div className="basket-lines">
                {basketLines.map((line) => (
                  <div className="basket-line" key={line.line_id}>
                    <div>
                      <strong>{line.name}</strong>
                      {line.removed_ingredients.map((ingredient) => <small key={ingredient.id}>No {ingredient.name}</small>)}
                      {line.selected_extras.map((extra) => <small key={extra.id}>+ {extra.quantity > 1 ? `${extra.quantity} × ` : ''}{extra.name}</small>)}
                      {line.special_instructions && <small>Note: {line.special_instructions}</small>}
                      <span>{money.format((line.unit_price_pence * line.quantity) / 100)}</span>
                    </div>
                    <div className="basket-quantity"><button type="button" onClick={() => changeQuantity(line.line_id, -1)}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeQuantity(line.line_id, 1)}>+</button></div>
                  </div>
                ))}
              </div>
              <div className="basket-costs">
                <div><span>Subtotal</span><strong>{money.format(subtotal / 100)}</strong></div>
                {restaurant.accepts_delivery && <div><span>Delivery</span><strong>{deliveryFee ? money.format(deliveryFee / 100) : 'Free'}</strong></div>}
                <div className="basket-total"><span>Total</span><strong>{money.format(total / 100)}</strong></div>
              </div>
              {minimumShortfall > 0 && <p className="basket-warning">Add {money.format(minimumShortfall / 100)} more to reach the minimum order.</p>}
              <button className="basket-checkout" type="button" disabled={!canContinue} onClick={() => navigate(`/r/${slug}/checkout`)}>Continue</button>
              <p className="basket-note">Delivery details and payment are added in the next checkout step.</p>
            </>
          )}
        </aside>
      </div>

      {itemCount > 0 && <button className="mobile-basket-button" type="button" onClick={() => document.querySelector('.basket-panel')?.scrollIntoView({ behavior: 'smooth' })}><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span><strong>View basket · {money.format(total / 100)}</strong></button>}

      {customisingItem && (
        <div className="customisation-overlay" role="presentation" onMouseDown={closeCustomisation}>
          <section className="customisation-modal" role="dialog" aria-modal="true" aria-labelledby="customisation-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="customisation-header">
              <div><span>Customise your item</span><h2 id="customisation-title">{customisingItem.name}</h2><p>{customisingItem.description}</p></div>
              <button type="button" onClick={closeCustomisation} aria-label="Close">×</button>
            </header>

            <div className="customisation-content">
              {!!customisingItem.ingredients.length && (
                <section className="customisation-section">
                  <div className="customisation-section-heading"><div><h3>Included ingredients</h3><p>Untick anything you do not want.</p></div></div>
                  <div className="ingredient-options">
                    {customisingItem.ingredients.map((ingredient) => {
                      const included = !removedIngredientIds.includes(ingredient.id)
                      return <button className={included ? 'ingredient-option selected' : 'ingredient-option'} type="button" key={ingredient.id} onClick={() => toggleIngredient(ingredient)} disabled={!ingredient.is_removable}><span className="selection-box">{included ? '✓' : ''}</span><span>{ingredient.name}{!ingredient.is_removable && <small>Always included</small>}</span></button>
                    })}
                  </div>
                </section>
              )}

              {!!customisingItem.extras.length && (
                <section className="customisation-section">
                  <div className="customisation-section-heading"><div><h3>Add extras</h3><p>Choose any extras you would like.</p></div><span>Optional</span></div>
                  <div className="extra-options">
                    {customisingItem.extras.map((extra) => {
                      const quantity = extraQuantities[extra.id] || 0
                      return <div className="extra-option" key={extra.id}><div><strong>{extra.name}</strong><span>{extra.price_pence ? `+${money.format(extra.price_pence / 100)}` : 'Free'}</span></div><div className="extra-quantity"><button type="button" onClick={() => changeExtra(extra, -1)} disabled={!quantity}>−</button><span>{quantity}</span><button type="button" onClick={() => changeExtra(extra, 1)} disabled={quantity >= extra.max_quantity}>+</button></div></div>
                    })}
                  </div>
                </section>
              )}

              <section className="customisation-section">
                <div className="customisation-section-heading"><div><h3>Special instructions</h3><p>We will pass this note to the kitchen.</p></div><span>Optional</span></div>
                <textarea value={specialInstructions} onChange={(event) => setSpecialInstructions(event.target.value.slice(0, 180))} rows={3} placeholder="For example, sauce on the side" />
                <small className="instruction-count">{specialInstructions.length}/180</small>
              </section>
            </div>

            <footer className="customisation-footer">
              <div className="custom-quantity"><button type="button" onClick={() => setCustomQuantity((value) => Math.max(1, value - 1))}>−</button><strong>{customQuantity}</strong><button type="button" onClick={() => setCustomQuantity((value) => Math.min(20, value + 1))}>+</button></div>
              <button className="add-customised-button" type="button" onClick={addCustomisedItem}><span>Add to basket</span><strong>{money.format(customTotal / 100)}</strong></button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}
