import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Storefront.css'

type Ingredient = { id: string; name: string; is_included: boolean; is_removable: boolean }
type Extra = { id: string; name: string; price_pence: number; max_quantity: number }
type ModifierOption = { id: string; name: string; price_pence: number; maximum_quantity: number; is_default: boolean; sort_order: number }
type ModifierGroup = {
  id: string
  name: string
  description: string | null
  selection_type: 'single' | 'multiple'
  minimum_selections: number
  maximum_selections: number | null
  free_selections: number
  sort_order: number
  options: ModifierOption[]
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
  modifier_groups: ModifierGroup[]
}
type Category = { id: string; name: string; description: string | null; items: MenuItem[] }
type Restaurant = {
  id: string; name: string; slug: string; logo_url: string | null; cover_url: string | null
  cuisines: string[] | null; accepts_delivery: boolean; accepts_collection: boolean
  minimum_order_pence: number | null; delivery_fee_pence: number | null
  preparation_time_minutes: number | null; free_delivery_threshold_pence: number | null
}
type StorefrontData = { restaurant: Restaurant; categories: Category[] }
type SelectedExtra = Extra & { quantity: number }
type SelectedModifierOption = ModifierOption & { quantity: number }
type SelectedModifierGroup = { group_id: string; group_name: string; options: SelectedModifierOption[] }
type BasketLine = MenuItem & {
  line_id: string
  quantity: number
  removed_ingredients: Ingredient[]
  selected_extras: SelectedExtra[]
  selected_modifier_groups: SelectedModifierGroup[]
  special_instructions: string
  unit_price_pence: number
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

function modifierCharge(group: ModifierGroup, quantities: Record<string, number>) {
  const units = group.options.flatMap((option) =>
    Array.from({ length: quantities[option.id] || 0 }, () => option.price_pence),
  )
  const free = [...units].sort((a, b) => b - a).slice(0, group.free_selections).reduce((sum, price) => sum + price, 0)
  return Math.max(units.reduce((sum, price) => sum + price, 0) - free, 0)
}

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
  const [modifierQuantities, setModifierQuantities] = useState<Record<string, Record<string, number>>>({})
  const [customQuantity, setCustomQuantity] = useState(1)
  const [specialInstructions, setSpecialInstructions] = useState('')
  const [customisationError, setCustomisationError] = useState('')

  useEffect(() => {
    if (!slug) return
    const storageKey = `ordered-food-basket:${slug}`
    const saved = window.localStorage.getItem(storageKey)
    if (saved) {
      try { setBasket(JSON.parse(saved)) } catch { window.localStorage.removeItem(storageKey) }
    }
    async function loadStorefront() {
      setLoading(true)
      setError('')
      const { data: storefront, error: rpcError } = await supabase.rpc('get_public_storefront', { storefront_slug: slug })
      if (rpcError) setError(rpcError.message)
      else if (!storefront) setError('Restaurant not found.')
      else setData(storefront as StorefrontData)
      setLoading(false)
    }
    void loadStorefront()
  }, [slug])

  useEffect(() => {
    if (slug) window.localStorage.setItem(`ordered-food-basket:${slug}`, JSON.stringify(basket))
  }, [basket, slug])

  useEffect(() => {
    document.body.style.overflow = customisingItem ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [customisingItem])

  const filteredCategories = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLowerCase()
    if (!query) return data.categories
    return data.categories.map((category) => ({
      ...category,
      items: category.items.filter((item) => `${item.name} ${item.description ?? ''} ${(item.ingredients || []).map((x) => x.name).join(' ')} ${(item.modifier_groups || []).flatMap((g) => g.options.map((o) => o.name)).join(' ')}`.toLowerCase().includes(query)),
    })).filter((category) => category.items.length > 0)
  }, [data, search])

  const basketLines = Object.values(basket)
  const itemCount = basketLines.reduce((total, line) => total + line.quantity, 0)
  const subtotal = basketLines.reduce((total, line) => total + line.unit_price_pence * line.quantity, 0)
  const selectedExtras = customisingItem ? customisingItem.extras.map((extra) => ({ ...extra, quantity: extraQuantities[extra.id] || 0 })).filter((extra) => extra.quantity > 0) : []
  const selectedModifierGroups: SelectedModifierGroup[] = customisingItem ? customisingItem.modifier_groups.map((group) => ({
    group_id: group.id,
    group_name: group.name,
    options: group.options.map((option) => ({ ...option, quantity: modifierQuantities[group.id]?.[option.id] || 0 })).filter((option) => option.quantity > 0),
  })).filter((group) => group.options.length > 0) : []
  const modifierTotal = customisingItem?.modifier_groups.reduce((sum, group) => sum + modifierCharge(group, modifierQuantities[group.id] || {}), 0) || 0
  const customUnitPrice = (customisingItem?.price_pence || 0) + selectedExtras.reduce((sum, extra) => sum + extra.price_pence * extra.quantity, 0) + modifierTotal
  const customTotal = customUnitPrice * customQuantity

  function openCustomisation(item: MenuItem) {
    setCustomisingItem(item)
    setRemovedIngredientIds([])
    setExtraQuantities({})
    const defaults: Record<string, Record<string, number>> = {}
    for (const group of item.modifier_groups || []) {
      const groupDefaults: Record<string, number> = {}
      for (const option of group.options) {
        if (option.is_default) groupDefaults[option.id] = 1
      }
      defaults[group.id] = groupDefaults
    }
    setModifierQuantities(defaults)
    setCustomQuantity(1)
    setSpecialInstructions('')
    setCustomisationError('')
  }

  function closeCustomisation() { setCustomisingItem(null) }
  function toggleIngredient(ingredient: Ingredient) {
    if (!ingredient.is_removable) return
    setRemovedIngredientIds((current) => current.includes(ingredient.id) ? current.filter((id) => id !== ingredient.id) : [...current, ingredient.id])
  }
  function changeExtra(extra: Extra, amount: number) {
    setExtraQuantities((current) => ({ ...current, [extra.id]: Math.max(0, Math.min(extra.max_quantity, (current[extra.id] || 0) + amount)) }))
  }
  function changeModifier(group: ModifierGroup, option: ModifierOption, amount: number) {
    setCustomisationError('')
    setModifierQuantities((current) => {
      const groupValues = { ...(current[group.id] || {}) }
      if (group.selection_type === 'single' && amount > 0) {
        for (const id of Object.keys(groupValues)) groupValues[id] = 0
        groupValues[option.id] = 1
      } else {
        const selected = Object.values(groupValues).reduce((sum, quantity) => sum + quantity, 0)
        const currentQuantity = groupValues[option.id] || 0
        const maximum = group.maximum_selections ?? Number.POSITIVE_INFINITY
        if (amount > 0 && selected >= maximum) return current
        groupValues[option.id] = Math.max(0, Math.min(option.maximum_quantity, currentQuantity + amount))
      }
      return { ...current, [group.id]: groupValues }
    })
  }

  function addCustomisedItem() {
    if (!customisingItem) return
    for (const group of customisingItem.modifier_groups || []) {
      const selected = Object.values(modifierQuantities[group.id] || {}).reduce((sum, quantity) => sum + quantity, 0)
      if (selected < group.minimum_selections) {
        setCustomisationError(`${group.name}: choose at least ${group.minimum_selections}.`)
        return
      }
      if (group.maximum_selections != null && selected > group.maximum_selections) {
        setCustomisationError(`${group.name}: choose no more than ${group.maximum_selections}.`)
        return
      }
    }
    const removedIngredients = customisingItem.ingredients.filter((ingredient) => removedIngredientIds.includes(ingredient.id))
    const configurationKey = JSON.stringify({
      item: customisingItem.id,
      removed: removedIngredientIds.slice().sort(),
      extras: selectedExtras.map((extra) => [extra.id, extra.quantity]),
      modifiers: selectedModifierGroups.map((group) => [group.group_id, group.options.map((option) => [option.id, option.quantity])]),
      notes: specialInstructions.trim(),
    })
    const lineId = `${customisingItem.id}:${btoa(unescape(encodeURIComponent(configurationKey))).slice(0, 32)}`
    setBasket((current) => {
      const existing = current[lineId]
      return { ...current, [lineId]: {
        ...customisingItem,
        line_id: lineId,
        quantity: (existing?.quantity || 0) + customQuantity,
        removed_ingredients: removedIngredients,
        selected_extras: selectedExtras,
        selected_modifier_groups: selectedModifierGroups,
        special_instructions: specialInstructions.trim(),
        unit_price_pence: customUnitPrice,
      } }
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

  if (loading) return <main className="storefront-state">Loading menu…</main>
  if (error || !data) return <main className="storefront-state"><h1>Unable to load restaurant</h1><p>{error}</p></main>

  const { restaurant } = data
  const deliveryFee = restaurant.accepts_delivery && restaurant.delivery_fee_pence && (!restaurant.free_delivery_threshold_pence || subtotal < restaurant.free_delivery_threshold_pence) ? restaurant.delivery_fee_pence : 0
  const total = subtotal + deliveryFee
  const minimumShortfall = Math.max((restaurant.minimum_order_pence ?? 0) - subtotal, 0)
  const canContinue = basketLines.length > 0 && minimumShortfall === 0

  return (
    <main className="storefront-page">
      <section className="storefront-hero">
        {restaurant.cover_url && <img className="storefront-cover" src={restaurant.cover_url} alt="" />}
        <div className="storefront-hero-overlay" />
        <div className="storefront-identity">{restaurant.logo_url ? <img className="storefront-logo" src={restaurant.logo_url} alt={`${restaurant.name} logo`} /> : <div className="storefront-logo storefront-logo-fallback">{restaurant.name.slice(0, 1)}</div>}<div><span className="storefront-brand">ordered.food</span><h1>{restaurant.name}</h1><p>{restaurant.cuisines?.join(' · ') || 'Freshly prepared food'}</p></div></div>
      </section>
      <section className="storefront-summary"><div className="storefront-pills">{restaurant.accepts_delivery && <span>Delivery</span>}{restaurant.accepts_collection && <span>Collection</span>}{restaurant.preparation_time_minutes && <span>{restaurant.preparation_time_minutes} min</span>}</div><div className="storefront-fees">{restaurant.minimum_order_pence != null && <span>Min. {money.format(restaurant.minimum_order_pence / 100)}</span>}{restaurant.delivery_fee_pence != null && <span>Delivery {money.format(restaurant.delivery_fee_pence / 100)}</span>}{restaurant.free_delivery_threshold_pence != null && <span>Free over {money.format(restaurant.free_delivery_threshold_pence / 100)}</span>}</div></section>
      <nav className="storefront-category-nav" aria-label="Menu categories"><div>{data.categories.map((category) => <button key={category.id} type="button" onClick={() => document.getElementById(`category-${category.id}`)?.scrollIntoView({ behavior: 'smooth' })}>{category.name}</button>)}</div></nav>
      <div className="storefront-layout">
        <section className="storefront-menu">
          <div className="storefront-search-wrap"><input className="storefront-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the menu" aria-label="Search the menu" /></div>
          {!filteredCategories.length && <p className="storefront-empty">No menu items match your search.</p>}
          {filteredCategories.map((category) => <section className="menu-category" id={`category-${category.id}`} key={category.id}><header><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}</header><div className="menu-item-grid">{category.items.map((item) => <article className="menu-item-card" key={item.id} onClick={() => openCustomisation(item)}><div className="menu-item-copy"><div><h3>{item.name}</h3>{item.description && <p>{item.description}</p>}{!!item.ingredients?.length && <p className="ingredient-summary">{item.ingredients.map((ingredient) => ingredient.name).join(', ')}</p>}<div className="menu-item-tags">{item.is_vegan && <span>Vegan</span>}{!item.is_vegan && item.is_vegetarian && <span>Vegetarian</span>}{(item.extras?.length > 0 || item.modifier_groups?.length > 0) && <span className="customisable-tag">Customisable</span>}</div></div><strong>{money.format(item.price_pence / 100)}</strong></div><div className="menu-item-action">{item.image_url && <img src={item.image_url} alt={item.name} />}<button type="button" onClick={(event) => { event.stopPropagation(); openCustomisation(item) }} aria-label={`Customise ${item.name}`}>+</button></div></article>)}</div></section>)}
        </section>
        <aside className="basket-panel">
          <div className="basket-heading"><div><span>Your order</span><h2>Basket</h2></div><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span></div>
          {!basketLines.length ? <div className="basket-empty"><div>🛍️</div><h3>Your basket is empty</h3><p>Add something tasty from the menu.</p></div> : <><div className="basket-lines">{basketLines.map((line) => <div className="basket-line" key={line.line_id}><div><strong>{line.name}</strong>{line.removed_ingredients?.map((ingredient) => <small key={ingredient.id}>No {ingredient.name}</small>)}{line.selected_extras?.map((extra) => <small key={extra.id}>+ {extra.quantity > 1 ? `${extra.quantity} × ` : ''}{extra.name}</small>)}{line.selected_modifier_groups?.flatMap((group) => group.options.map((option) => <small key={`${group.group_id}-${option.id}`}>{group.group_name}: {option.quantity > 1 ? `${option.quantity} × ` : ''}{option.name}</small>))}{line.special_instructions && <small>Note: {line.special_instructions}</small>}<span>{money.format((line.unit_price_pence * line.quantity) / 100)}</span></div><div className="basket-quantity"><button type="button" onClick={() => changeQuantity(line.line_id, -1)}>−</button><span>{line.quantity}</span><button type="button" onClick={() => changeQuantity(line.line_id, 1)}>+</button></div></div>)}</div><div className="basket-costs"><div><span>Subtotal</span><strong>{money.format(subtotal / 100)}</strong></div>{restaurant.accepts_delivery && <div><span>Delivery</span><strong>{deliveryFee ? money.format(deliveryFee / 100) : 'Free'}</strong></div>}<div className="basket-total"><span>Total</span><strong>{money.format(total / 100)}</strong></div></div>{minimumShortfall > 0 && <p className="basket-warning">Add {money.format(minimumShortfall / 100)} more to reach the minimum order.</p>}<button className="basket-checkout" type="button" disabled={!canContinue} onClick={() => navigate(`/r/${slug}/checkout`)}>Continue</button><p className="basket-note">Delivery details and payment are added in the next checkout step.</p></>}
        </aside>
      </div>
      {itemCount > 0 && <button className="mobile-basket-button" type="button" onClick={() => document.querySelector('.basket-panel')?.scrollIntoView({ behavior: 'smooth' })}><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span><strong>View basket · {money.format(total / 100)}</strong></button>}
      {customisingItem && <div className="customisation-overlay" role="presentation" onMouseDown={closeCustomisation}><section className="customisation-modal" role="dialog" aria-modal="true" aria-labelledby="customisation-title" onMouseDown={(event) => event.stopPropagation()}><header className="customisation-header"><div><span>Customise your item</span><h2 id="customisation-title">{customisingItem.name}</h2><p>{customisingItem.description}</p></div><button type="button" onClick={closeCustomisation} aria-label="Close">×</button></header><div className="customisation-content">
        {!!customisingItem.ingredients.length && <section className="customisation-section"><div className="customisation-section-heading"><div><h3>Included ingredients</h3><p>Untick anything you do not want.</p></div></div><div className="ingredient-options">{customisingItem.ingredients.map((ingredient) => { const included = !removedIngredientIds.includes(ingredient.id); return <button className={included ? 'ingredient-option selected' : 'ingredient-option'} type="button" key={ingredient.id} onClick={() => toggleIngredient(ingredient)} disabled={!ingredient.is_removable}><span className="selection-box">{included ? '✓' : ''}</span><span>{ingredient.name}{!ingredient.is_removable && <small>Always included</small>}</span></button> })}</div></section>}
        {(customisingItem.modifier_groups || []).map((group) => { const chosen = Object.values(modifierQuantities[group.id] || {}).reduce((sum, quantity) => sum + quantity, 0); return <section className="customisation-section" key={group.id}><div className="customisation-section-heading"><div><h3>{group.name}</h3><p>{group.description || (group.selection_type === 'single' ? 'Choose one option.' : 'Choose any options you would like.')}</p></div><span>{group.minimum_selections > 0 ? 'Required' : 'Optional'}{group.maximum_selections ? ` · Up to ${group.maximum_selections}` : ''}</span></div><div className="extra-options">{group.options.map((option) => { const quantity = modifierQuantities[group.id]?.[option.id] || 0; return <div className="extra-option" key={option.id}><div><strong>{option.name}</strong><span>{option.price_pence ? `+${money.format(option.price_pence / 100)}` : 'Free'}</span></div><div className="extra-quantity"><button type="button" onClick={() => changeModifier(group, option, -1)} disabled={!quantity}>−</button><span>{quantity}</span><button type="button" onClick={() => changeModifier(group, option, 1)} disabled={quantity >= option.maximum_quantity || (group.maximum_selections != null && chosen >= group.maximum_selections)}>+</button></div></div> })}</div>{group.free_selections > 0 && <small>First {group.free_selections} selection{group.free_selections === 1 ? '' : 's'} included.</small>}</section> })}
        {!!customisingItem.extras.length && <section className="customisation-section"><div className="customisation-section-heading"><div><h3>Other extras</h3><p>Choose any item-specific extras.</p></div><span>Optional</span></div><div className="extra-options">{customisingItem.extras.map((extra) => { const quantity = extraQuantities[extra.id] || 0; return <div className="extra-option" key={extra.id}><div><strong>{extra.name}</strong><span>{extra.price_pence ? `+${money.format(extra.price_pence / 100)}` : 'Free'}</span></div><div className="extra-quantity"><button type="button" onClick={() => changeExtra(extra, -1)} disabled={!quantity}>−</button><span>{quantity}</span><button type="button" onClick={() => changeExtra(extra, 1)} disabled={quantity >= extra.max_quantity}>+</button></div></div> })}</div></section>}
        <section className="customisation-section"><div className="customisation-section-heading"><div><h3>Special instructions</h3><p>We will pass this note to the kitchen.</p></div><span>Optional</span></div><textarea value={specialInstructions} onChange={(event) => setSpecialInstructions(event.target.value.slice(0, 180))} rows={3} placeholder="For example, sauce on the side" /><small className="instruction-count">{specialInstructions.length}/180</small></section>{customisationError && <p className="basket-warning">{customisationError}</p>}</div><footer className="customisation-footer"><div className="custom-quantity"><button type="button" onClick={() => setCustomQuantity((value) => Math.max(1, value - 1))}>−</button><strong>{customQuantity}</strong><button type="button" onClick={() => setCustomQuantity((value) => Math.min(20, value + 1))}>+</button></div><button className="add-customised-button" type="button" onClick={addCustomisedItem}><span>Add to basket</span><strong>{money.format(customTotal / 100)}</strong></button></footer></section></div>}
    </main>
  )
}
