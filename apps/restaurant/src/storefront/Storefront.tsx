import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
  is_available: boolean
  ingredients: Ingredient[]
  extras: Extra[]
  modifier_groups: ModifierGroup[]
}
type Category = { id: string; name: string; description: string | null; items: MenuItem[] }
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
type StorefrontData = { restaurant: Restaurant; categories: Category[] }
type ManagementMenuItem = Omit<MenuItem, 'ingredients' | 'extras' | 'modifier_groups'> & { sort_order: number }
type ManagementCategory = {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
  menu_items: ManagementMenuItem[]
}
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
  const freeValue = [...units]
    .sort((a, b) => b - a)
    .slice(0, group.free_selections)
    .reduce((sum, price) => sum + price, 0)
  return Math.max(units.reduce((sum, price) => sum + price, 0) - freeValue, 0)
}

function basketLineId(itemId: string, configuration: unknown) {
  const value = JSON.stringify(configuration)
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0
  }
  return `${itemId}:${Math.abs(hash).toString(36)}`
}

export default function Storefront() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const managementRequested = searchParams.get('manage_menu') === '1'
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
  const [basketMessage, setBasketMessage] = useState('')
  const [customerUserId, setCustomerUserId] = useState<string | null>(null)
  const [favouriteRestaurant, setFavouriteRestaurant] = useState(false)
  const [favouriteItemIds, setFavouriteItemIds] = useState<Set<string>>(new Set())
  const [restaurantFavouriteBusy, setRestaurantFavouriteBusy] = useState(false)
  const [itemFavouriteBusy, setItemFavouriteBusy] = useState<Set<string>>(new Set())
  const [managementMode, setManagementMode] = useState(false)
  const [managementError, setManagementError] = useState('')
  const [availabilityBusy, setAvailabilityBusy] = useState<Set<string>>(new Set())

  const loadManagementMenu = useCallback(async (storefront: StorefrontData) => {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setManagementError('Sign in to your restaurant account to manage menu availability.')
      return null
    }

    const { data: membership, error: membershipError } = await supabase
      .from('restaurant_members')
      .select('restaurant_id, role')
      .eq('user_id', authData.user.id)
      .eq('restaurant_id', storefront.restaurant.id)
      .in('role', ['owner', 'manager'])
      .maybeSingle()

    if (membershipError) {
      setManagementError(membershipError.message)
      return null
    }
    if (!membership) {
      setManagementError('Only this restaurant\'s owner or manager can change menu availability.')
      return null
    }

    const { data: categoryRows, error: menuError } = await supabase
      .from('menu_categories')
      .select(`
        id, name, description, sort_order, is_active,
        menu_items(id, name, description, price_pence, image_url, is_available, is_vegetarian, is_vegan, sort_order)
      `)
      .eq('restaurant_id', storefront.restaurant.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('sort_order', { referencedTable: 'menu_items', ascending: true })

    if (menuError) {
      setManagementError(menuError.message)
      return null
    }

    const publicItems = new Map(
      storefront.categories.flatMap((category) => category.items).map((item) => [item.id, item]),
    )
    const categories = ((categoryRows ?? []) as ManagementCategory[]).map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      items: (category.menu_items ?? []).map((item) => ({
        ...(publicItems.get(item.id) ?? item),
        is_available: item.is_available,
        ingredients: publicItems.get(item.id)?.ingredients ?? [],
        extras: publicItems.get(item.id)?.extras ?? [],
        modifier_groups: publicItems.get(item.id)?.modifier_groups ?? [],
      })),
    }))

    setManagementError('')
    setManagementMode(true)
    return { ...storefront, categories }
  }, [])

  const loadStorefront = useCallback(async (silent = false) => {
    if (!slug) return
    if (!silent) setLoading(true)
    setError('')
    const { data: storefront, error: rpcError } = await supabase.rpc('get_public_storefront', { storefront_slug: slug })
    if (rpcError) setError(rpcError.message)
    else if (!storefront) setError('Restaurant not found.')
    else {
      const publicStorefront = storefront as StorefrontData
      publicStorefront.categories = publicStorefront.categories.map((category) => ({
        ...category,
        items: category.items.map((item) => ({ ...item, is_available: true })),
      }))
      if (managementRequested) {
        setManagementMode(false)
        setData(await loadManagementMenu(publicStorefront) ?? publicStorefront)
      } else {
        setManagementError('')
        setManagementMode(false)
        setData(publicStorefront)
      }
    }
    if (!silent) setLoading(false)
  }, [loadManagementMenu, managementRequested, slug])

  useEffect(() => {
    if (!slug) return
    const storageKey = `ordered-food-basket:${slug}`
    const saved = window.localStorage.getItem(storageKey)
    if (saved) {
      try {
        setBasket(JSON.parse(saved) as Record<string, BasketLine>)
      } catch {
        window.localStorage.removeItem(storageKey)
      }
    }

    void loadStorefront()
  }, [loadStorefront, slug])

  useEffect(() => {
    function refreshVisibleStorefront() {
      if (document.visibilityState === 'visible') void loadStorefront(true)
    }

    window.addEventListener('focus', refreshVisibleStorefront)
    document.addEventListener('visibilitychange', refreshVisibleStorefront)
    return () => {
      window.removeEventListener('focus', refreshVisibleStorefront)
      document.removeEventListener('visibilitychange', refreshVisibleStorefront)
    }
  }, [loadStorefront])

  useEffect(() => {
    if (!data) return

    async function loadFavourites() {
      const { data: authData } = await supabase.auth.getUser()
      const userId = authData.user?.id ?? null
      setCustomerUserId(userId)
      if (!userId) return

      const itemIds = data?.categories.flatMap((category) => category.items.map((item) => item.id)) ?? []
      const [restaurantResult, itemResult] = await Promise.all([
        supabase
          .from('customer_favourite_restaurants')
          .select('restaurant_id')
          .eq('user_id', userId)
          .eq('restaurant_id', data!.restaurant.id)
          .maybeSingle(),
        itemIds.length
          ? supabase
            .from('customer_favourite_items')
            .select('menu_item_id')
            .eq('user_id', userId)
            .in('menu_item_id', itemIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (!restaurantResult.error) setFavouriteRestaurant(Boolean(restaurantResult.data))
      if (!itemResult.error) {
        setFavouriteItemIds(new Set((itemResult.data ?? []).map((row) => row.menu_item_id as string)))
      }
    }

    void loadFavourites()
  }, [data])

  useEffect(() => {
    if (!slug) return
    try {
      window.localStorage.setItem(`ordered-food-basket:${slug}`, JSON.stringify(basket))
    } catch {
      setError('Your basket could not be saved on this device.')
    }
  }, [basket, slug])

  useEffect(() => {
    document.body.style.overflow = customisingItem ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [customisingItem])

  useEffect(() => {
    if (!basketMessage) return
    const timeout = window.setTimeout(() => setBasketMessage(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [basketMessage])

  const filteredCategories = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLowerCase()
    if (!query) return data.categories
    return data.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          `${item.name} ${item.description ?? ''} ${(item.ingredients || []).map((ingredient) => ingredient.name).join(' ')} ${(item.modifier_groups || []).flatMap((group) => group.options.map((option) => option.name)).join(' ')}`
            .toLowerCase()
            .includes(query),
        ),
      }))
      .filter((category) => category.items.length > 0)
  }, [data, search])

  const basketLines = Object.values(basket)
  const itemCount = basketLines.reduce((total, line) => total + line.quantity, 0)
  const subtotal = basketLines.reduce((total, line) => total + line.unit_price_pence * line.quantity, 0)
  const selectedExtras = customisingItem
    ? (customisingItem.extras || []).map((extra) => ({ ...extra, quantity: extraQuantities[extra.id] || 0 })).filter((extra) => extra.quantity > 0)
    : []
  const selectedModifierGroups: SelectedModifierGroup[] = customisingItem
    ? (customisingItem.modifier_groups || []).map((group) => ({
      group_id: group.id,
      group_name: group.name,
      options: (group.options || []).map((option) => ({ ...option, quantity: modifierQuantities[group.id]?.[option.id] || 0 })).filter((option) => option.quantity > 0),
    })).filter((group) => group.options.length > 0)
    : []
  const modifierTotal = customisingItem
    ? (customisingItem.modifier_groups || []).reduce((sum, group) => sum + modifierCharge(group, modifierQuantities[group.id] || {}), 0)
    : 0
  const customUnitPrice = (customisingItem?.price_pence || 0)
    + selectedExtras.reduce((sum, extra) => sum + extra.price_pence * extra.quantity, 0)
    + modifierTotal
  const customTotal = customUnitPrice * customQuantity

  function requireCustomerLogin() {
    navigate(`/account/login?redirect=${encodeURIComponent(window.location.pathname)}`)
  }

  async function toggleRestaurantFavourite() {
    if (!data || restaurantFavouriteBusy) return
    if (!customerUserId) {
      requireCustomerLogin()
      return
    }

    setRestaurantFavouriteBusy(true)
    const wasFavourite = favouriteRestaurant
    setFavouriteRestaurant(!wasFavourite)

    const result = wasFavourite
      ? await supabase
        .from('customer_favourite_restaurants')
        .delete()
        .eq('user_id', customerUserId)
        .eq('restaurant_id', data.restaurant.id)
      : await supabase
        .from('customer_favourite_restaurants')
        .insert({ user_id: customerUserId, restaurant_id: data.restaurant.id })

    if (result.error) {
      setFavouriteRestaurant(wasFavourite)
      setBasketMessage('Could not update your favourites')
    } else {
      setBasketMessage(wasFavourite ? 'Restaurant removed from favourites' : 'Restaurant saved to favourites')
    }
    setRestaurantFavouriteBusy(false)
  }

  async function toggleItemFavourite(item: MenuItem) {
    if (itemFavouriteBusy.has(item.id)) return
    if (!customerUserId) {
      requireCustomerLogin()
      return
    }

    const wasFavourite = favouriteItemIds.has(item.id)
    setItemFavouriteBusy((current) => new Set(current).add(item.id))
    setFavouriteItemIds((current) => {
      const next = new Set(current)
      if (wasFavourite) next.delete(item.id)
      else next.add(item.id)
      return next
    })

    const result = wasFavourite
      ? await supabase
        .from('customer_favourite_items')
        .delete()
        .eq('user_id', customerUserId)
        .eq('menu_item_id', item.id)
      : await supabase
        .from('customer_favourite_items')
        .insert({ user_id: customerUserId, menu_item_id: item.id })

    if (result.error) {
      setFavouriteItemIds((current) => {
        const next = new Set(current)
        if (wasFavourite) next.add(item.id)
        else next.delete(item.id)
        return next
      })
      setBasketMessage('Could not update your favourites')
    } else {
      setBasketMessage(wasFavourite ? `${item.name} removed from favourites` : `${item.name} saved to favourites`)
    }

    setItemFavouriteBusy((current) => {
      const next = new Set(current)
      next.delete(item.id)
      return next
    })
  }

  function openCustomisation(item: MenuItem) {
    if (managementMode || !item.is_available) return
    setCustomisingItem(item)
    setRemovedIngredientIds([])
    setExtraQuantities({})
    const defaults: Record<string, Record<string, number>> = {}
    for (const group of item.modifier_groups || []) {
      const groupDefaults: Record<string, number> = {}
      for (const option of group.options || []) {
        if (option.is_default) groupDefaults[option.id] = 1
      }
      defaults[group.id] = groupDefaults
    }
    setModifierQuantities(defaults)
    setCustomQuantity(1)
    setSpecialInstructions('')
    setCustomisationError('')
  }

  function closeCustomisation() {
    setCustomisingItem(null)
    setCustomisationError('')
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

    const removedIngredients = (customisingItem.ingredients || []).filter((ingredient) => removedIngredientIds.includes(ingredient.id))
    const configuration = {
      item: customisingItem.id,
      removed: removedIngredientIds.slice().sort(),
      extras: selectedExtras.map((extra) => [extra.id, extra.quantity]),
      modifiers: selectedModifierGroups.map((group) => [group.group_id, group.options.map((option) => [option.id, option.quantity])]),
      notes: specialInstructions.trim(),
    }
    const lineId = basketLineId(customisingItem.id, configuration)
    const addedName = customisingItem.name

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
          selected_modifier_groups: selectedModifierGroups,
          special_instructions: specialInstructions.trim(),
          unit_price_pence: customUnitPrice,
        },
      }
    })
    closeCustomisation()
    setBasketMessage(`${addedName} added to your basket`)
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

  async function toggleMenuItemAvailability(item: MenuItem) {
    if (!data || !managementMode || availabilityBusy.has(item.id)) return
    const nextAvailability = !item.is_available
    setAvailabilityBusy((current) => new Set(current).add(item.id))
    setManagementError('')

    const { data: updatedItem, error: updateError } = await supabase
      .from('menu_items')
      .update({ is_available: nextAvailability, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('restaurant_id', data.restaurant.id)
      .select('id, is_available')
      .maybeSingle()

    if (updateError || !updatedItem) {
      setManagementError(updateError?.message || 'This item could not be updated.')
    } else {
      setData((current) => current ? {
        ...current,
        categories: current.categories.map((category) => ({
          ...category,
          items: category.items.map((entry) => entry.id === item.id
            ? { ...entry, is_available: updatedItem.is_available }
            : entry),
        })),
      } : current)
      setBasketMessage(updatedItem.is_available ? `${item.name} is available` : `${item.name} marked sold out`)
    }

    setAvailabilityBusy((current) => {
      const next = new Set(current)
      next.delete(item.id)
      return next
    })
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
        <div className="storefront-hero-actions">
          {managementMode ? (
            <Link className="storefront-account-link" to="/dashboard"><span aria-hidden="true">←</span> Dashboard</Link>
          ) : (
            <>
              <Link className="storefront-account-link" to={customerUserId ? '/account' : '/account/login'}>
                <span aria-hidden="true">◉</span>
                {customerUserId ? 'My account' : 'Sign in'}
              </Link>
              <button
                className={favouriteRestaurant ? 'storefront-favourite active' : 'storefront-favourite'}
                type="button"
                onClick={() => void toggleRestaurantFavourite()}
                disabled={restaurantFavouriteBusy}
                aria-label={favouriteRestaurant ? `Remove ${restaurant.name} from favourites` : `Save ${restaurant.name} to favourites`}
                aria-pressed={favouriteRestaurant}
              >
                {favouriteRestaurant ? '♥' : '♡'}
              </button>
            </>
          )}
        </div>
        <div className="storefront-identity">
          {restaurant.logo_url
            ? <img className="storefront-logo" src={restaurant.logo_url} alt={`${restaurant.name} logo`} />
            : <div className="storefront-logo storefront-logo-fallback">{restaurant.name.slice(0, 1)}</div>}
          <div><span className="storefront-brand">ordered.food</span><h1>{restaurant.name}</h1><p>{restaurant.cuisines?.join(' · ') || 'Freshly prepared food'}</p></div>
        </div>
      </section>

      {managementRequested && (
        <section className={managementMode ? 'storefront-management-banner' : 'storefront-management-banner storefront-management-banner--error'}>
          <div><span className="eyebrow">Restaurant view</span><h2>{managementMode ? 'Manage item availability' : 'Management controls unavailable'}</h2><p>{managementMode ? 'Switch items on or off below. Changes are live immediately and sold-out items remain here so you can enable them again.' : managementError}</p></div>
          <Link className="secondary-button button-link" to="/menu">Open full menu editor</Link>
        </section>
      )}

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

      <nav className="storefront-category-nav" aria-label="Menu categories">
        <div>{data.categories.map((category) => <button key={category.id} type="button" onClick={() => document.getElementById(`category-${category.id}`)?.scrollIntoView({ behavior: 'smooth' })}>{category.name}</button>)}</div>
      </nav>

      <div className={managementMode ? 'storefront-layout storefront-layout--management' : 'storefront-layout'}>
        <section className="storefront-menu">
          <div className="storefront-search-wrap"><input className="storefront-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the menu" aria-label="Search the menu" /></div>
          {!filteredCategories.length && (
            <div className="storefront-empty">
              <p>{search.trim() ? 'No menu items match your search.' : 'The menu has no available items yet.'}</p>
              {!search.trim() && <button type="button" onClick={() => void loadStorefront()}>Refresh menu</button>}
            </div>
          )}
          {filteredCategories.map((category) => (
            <section className="menu-category" id={`category-${category.id}`} key={category.id}>
              <header><h2>{category.name}</h2>{category.description && <p>{category.description}</p>}</header>
              <div className="menu-item-grid">
                {category.items.map((item) => (
                  <article className={item.is_available ? 'menu-item-card' : 'menu-item-card menu-item-card--unavailable'} key={item.id} onClick={() => openCustomisation(item)}>
                    {!managementMode && <button
                      className={favouriteItemIds.has(item.id) ? 'menu-item-favourite active' : 'menu-item-favourite'}
                      type="button"
                      onClick={(event) => { event.stopPropagation(); void toggleItemFavourite(item) }}
                      disabled={itemFavouriteBusy.has(item.id)}
                      aria-label={favouriteItemIds.has(item.id) ? `Remove ${item.name} from favourites` : `Save ${item.name} to favourites`}
                      aria-pressed={favouriteItemIds.has(item.id)}
                    >
                      {favouriteItemIds.has(item.id) ? '♥' : '♡'}
                    </button>}
                    <div className="menu-item-copy">
                      <div>
                        <h3>{item.name}</h3>
                        {item.description && <p>{item.description}</p>}
                        {!!item.ingredients?.length && <p className="ingredient-summary">{item.ingredients.map((ingredient) => ingredient.name).join(', ')}</p>}
                        <div className="menu-item-tags">
                          {item.is_vegan && <span>Vegan</span>}
                          {!item.is_vegan && item.is_vegetarian && <span>Vegetarian</span>}
                          {(item.extras?.length > 0 || item.modifier_groups?.length > 0) && <span className="customisable-tag">Customisable</span>}
                          {managementMode && !item.is_available && <span className="sold-out-tag">Sold out</span>}
                        </div>
                      </div>
                      <strong>{money.format(item.price_pence / 100)}</strong>
                    </div>
                    <div className="menu-item-action">
                      {item.image_url && <img src={item.image_url} alt={item.name} />}
                      {managementMode ? (
                        <button
                          className={item.is_available ? 'menu-item-availability-toggle active' : 'menu-item-availability-toggle'}
                          type="button"
                          onClick={(event) => { event.stopPropagation(); void toggleMenuItemAvailability(item) }}
                          disabled={availabilityBusy.has(item.id)}
                          aria-pressed={item.is_available}
                        >
                          {availabilityBusy.has(item.id) ? 'Saving…' : item.is_available ? 'Available' : 'Sold out'}
                        </button>
                      ) : (
                        <button type="button" onClick={(event) => { event.stopPropagation(); openCustomisation(item) }} aria-label={`Customise ${item.name}`}>+</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>

        {!managementMode && <aside className="basket-panel">
          <div className="basket-heading"><div><span>Your order</span><h2>Basket</h2></div><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span></div>
          {!basketLines.length ? (
            <div className="basket-empty"><div>🛍️</div><h3>Your basket is empty</h3><p>Add something tasty from the menu.</p></div>
          ) : (
            <>
              <div className="basket-lines">
                {basketLines.map((line) => (
                  <div className="basket-line" key={line.line_id}>
                    <div>
                      <strong>{line.name}</strong>
                      {line.removed_ingredients?.map((ingredient) => <small key={ingredient.id}>No {ingredient.name}</small>)}
                      {line.selected_extras?.map((extra) => <small key={extra.id}>+ {extra.quantity > 1 ? `${extra.quantity} × ` : ''}{extra.name}</small>)}
                      {line.selected_modifier_groups?.flatMap((group) => group.options.map((option) => <small key={`${group.group_id}-${option.id}`}>{group.group_name}: {option.quantity > 1 ? `${option.quantity} × ` : ''}{option.name}</small>))}
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
        </aside>}
      </div>

      {basketMessage && <div className="basket-toast" role="status">✓ {basketMessage}</div>}
      {!managementMode && itemCount > 0 && <button className="mobile-basket-button" type="button" onClick={() => document.querySelector('.basket-panel')?.scrollIntoView({ behavior: 'smooth' })}><span>{itemCount} item{itemCount === 1 ? '' : 's'}</span><strong>View basket · {money.format(total / 100)}</strong></button>}

      {customisingItem && (
        <div className="customisation-overlay" role="presentation" onMouseDown={closeCustomisation}>
          <section className="customisation-modal" role="dialog" aria-modal="true" aria-labelledby="customisation-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="customisation-header">
              <div><span>Customise your item</span><h2 id="customisation-title">{customisingItem.name}</h2><p>{customisingItem.description}</p></div>
              <button type="button" onClick={closeCustomisation} aria-label="Close">×</button>
            </header>
            <div className="customisation-content">
              {!!(customisingItem.ingredients || []).length && (
                <section className="customisation-section">
                  <div className="customisation-section-heading"><div><h3>Included ingredients</h3><p>Untick anything you do not want.</p></div></div>
                  <div className="ingredient-options">{customisingItem.ingredients.map((ingredient) => {
                    const included = !removedIngredientIds.includes(ingredient.id)
                    return <button className={included ? 'ingredient-option selected' : 'ingredient-option'} type="button" key={ingredient.id} onClick={() => toggleIngredient(ingredient)} disabled={!ingredient.is_removable}><span className="selection-box">{included ? '✓' : ''}</span><span>{ingredient.name}{!ingredient.is_removable && <small>Always included</small>}</span></button>
                  })}</div>
                </section>
              )}

              {(customisingItem.modifier_groups || []).map((group) => {
                const chosen = Object.values(modifierQuantities[group.id] || {}).reduce((sum, quantity) => sum + quantity, 0)
                return (
                  <section className="customisation-section" key={group.id}>
                    <div className="customisation-section-heading"><div><h3>{group.name}</h3><p>{group.description || (group.selection_type === 'single' ? 'Choose one option.' : 'Choose any options you would like.')}</p></div><span>{group.minimum_selections > 0 ? 'Required' : 'Optional'}{group.maximum_selections ? ` · Up to ${group.maximum_selections}` : ''}</span></div>
                    <div className="extra-options">{group.options.map((option) => {
                      const quantity = modifierQuantities[group.id]?.[option.id] || 0
                      return <div className="extra-option" key={option.id}><div><strong>{option.name}</strong><span>{option.price_pence ? `+${money.format(option.price_pence / 100)}` : 'Free'}</span></div><div className="extra-quantity"><button type="button" onClick={() => changeModifier(group, option, -1)} disabled={!quantity}>−</button><span>{quantity}</span><button type="button" onClick={() => changeModifier(group, option, 1)} disabled={quantity >= option.maximum_quantity || (group.maximum_selections != null && chosen >= group.maximum_selections)}>+</button></div></div>
                    })}</div>
                    {group.free_selections > 0 && <small>First {group.free_selections} selection{group.free_selections === 1 ? '' : 's'} included.</small>}
                  </section>
                )
              })}

              {!!(customisingItem.extras || []).length && (
                <section className="customisation-section">
                  <div className="customisation-section-heading"><div><h3>Other extras</h3><p>Choose any item-specific extras.</p></div><span>Optional</span></div>
                  <div className="extra-options">{customisingItem.extras.map((extra) => {
                    const quantity = extraQuantities[extra.id] || 0
                    return <div className="extra-option" key={extra.id}><div><strong>{extra.name}</strong><span>{extra.price_pence ? `+${money.format(extra.price_pence / 100)}` : 'Free'}</span></div><div className="extra-quantity"><button type="button" onClick={() => changeExtra(extra, -1)} disabled={!quantity}>−</button><span>{quantity}</span><button type="button" onClick={() => changeExtra(extra, 1)} disabled={quantity >= extra.max_quantity}>+</button></div></div>
                  })}</div>
                </section>
              )}

              <section className="customisation-section">
                <div className="customisation-section-heading"><div><h3>Special instructions</h3><p>We will pass this note to the kitchen.</p></div><span>Optional</span></div>
                <textarea value={specialInstructions} onChange={(event) => setSpecialInstructions(event.target.value.slice(0, 180))} rows={3} placeholder="For example, sauce on the side" />
                <small className="instruction-count">{specialInstructions.length}/180</small>
              </section>
              {customisationError && <p className="basket-warning" role="alert">{customisationError}</p>}
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
