import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type MenuItem = {
  id: string
  name: string
  description: string | null
  price_pence: number
  image_url: string | null
  is_vegetarian: boolean
  is_vegan: boolean
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

type BasketLine = MenuItem & { quantity: number }

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
})

export default function Storefront() {
  const { slug } = useParams()
  const [data, setData] = useState<StorefrontData | null>(null)
  const [basket, setBasket] = useState<Record<string, BasketLine>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

      if (rpcError) {
        setError(rpcError.message)
      } else if (!storefront) {
        setError('Restaurant not found.')
      } else {
        setData(storefront as StorefrontData)
      }

      setLoading(false)
    }

    loadStorefront()
  }, [slug])

  useEffect(() => {
    if (!slug) return
    window.localStorage.setItem(`ordered-food-basket:${slug}`, JSON.stringify(basket))
  }, [basket, slug])

  const filteredCategories = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLowerCase()
    if (!query) return data.categories

    return data.categories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) =>
          `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query),
        ),
      }))
      .filter((category) => category.items.length > 0)
  }, [data, search])

  const basketLines = Object.values(basket)
  const itemCount = basketLines.reduce((total, line) => total + line.quantity, 0)
  const subtotal = basketLines.reduce((total, line) => total + line.price_pence * line.quantity, 0)

  function addItem(item: MenuItem) {
    setBasket((current) => ({
      ...current,
      [item.id]: {
        ...item,
        quantity: (current[item.id]?.quantity ?? 0) + 1,
      },
    }))
  }

  function changeQuantity(itemId: string, amount: number) {
    setBasket((current) => {
      const line = current[itemId]
      if (!line) return current
      const quantity = line.quantity + amount
      const next = { ...current }
      if (quantity <= 0) delete next[itemId]
      else next[itemId] = { ...line, quantity }
      return next
    })
  }

  if (loading) return <main className="storefront-state">Loading menu…</main>
  if (error || !data) return <main className="storefront-state"><h1>Unable to load restaurant</h1><p>{error}</p></main>

  const { restaurant } = data

  return (
    <main className="storefront-page">
      <section className="storefront-hero">
        {restaurant.cover_url && <img className="storefront-cover" src={restaurant.cover_url} alt="" />}
        <div className="storefront-hero-overlay" />
        <div className="storefront-identity">
          {restaurant.logo_url ? (
            <img className="storefront-logo" src={restaurant.logo_url} alt={`${restaurant.name} logo`} />
          ) : (
            <div className="storefront-logo storefront-logo-fallback">{restaurant.name.slice(0, 1)}</div>
          )}
          <div>
            <span className="storefront-brand">ordered.food</span>
            <h1>{restaurant.name}</h1>
            <p>{restaurant.cuisines?.join(' · ') || 'Freshly prepared food'}</p>
          </div>
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
        </div>
      </section>

      <div className="storefront-layout">
        <section className="storefront-menu">
          <div className="storefront-search-wrap">
            <input
              className="storefront-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the menu"
              aria-label="Search the menu"
            />
          </div>

          {!filteredCategories.length && <p className="storefront-empty">No menu items match your search.</p>}

          {filteredCategories.map((category) => (
            <section className="menu-category" id={`category-${category.id}`} key={category.id}>
              <header>
                <h2>{category.name}</h2>
                {category.description && <p>{category.description}</p>}
              </header>
              <div className="menu-item-grid">
                {category.items.map((item) => (
                  <article className="menu-item-card" key={item.id}>
                    <div className="menu-item-copy">
                      <div>
                        <h3>{item.name}</h3>
                        {item.description && <p>{item.description}</p>}
                        <div className="menu-item-tags">
                          {item.is_vegan && <span>Vegan</span>}
                          {!item.is_vegan && item.is_vegetarian && <span>Vegetarian</span>}
                        </div>
                      </div>
                      <strong>{money.format(item.price_pence / 100)}</strong>
                    </div>
                    <div className="menu-item-action">
                      {item.image_url && <img src={item.image_url} alt={item.name} />}
                      <button type="button" onClick={() => addItem(item)} aria-label={`Add ${item.name} to basket`}>+</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </section>

        <aside className="basket-panel">
          <div className="basket-heading">
            <div><span>Your order</span><h2>Basket</h2></div>
            <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>
          </div>

          {!basketLines.length ? (
            <div className="basket-empty"><div>🛍️</div><h3>Your basket is empty</h3><p>Add something tasty from the menu.</p></div>
          ) : (
            <>
              <div className="basket-lines">
                {basketLines.map((line) => (
                  <div className="basket-line" key={line.id}>
                    <div><strong>{line.name}</strong><span>{money.format((line.price_pence * line.quantity) / 100)}</span></div>
                    <div className="basket-quantity">
                      <button type="button" onClick={() => changeQuantity(line.id, -1)}>−</button>
                      <span>{line.quantity}</span>
                      <button type="button" onClick={() => changeQuantity(line.id, 1)}>+</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="basket-total"><span>Subtotal</span><strong>{money.format(subtotal / 100)}</strong></div>
              <button className="basket-checkout" type="button">Continue</button>
              <p className="basket-note">Delivery details and payment are added in the next checkout step.</p>
            </>
          )}
        </aside>
      </div>

      {itemCount > 0 && (
        <button className="mobile-basket-button" type="button" onClick={() => document.querySelector('.basket-panel')?.scrollIntoView({ behavior: 'smooth' })}>
          <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>
          <strong>View basket · {money.format(subtotal / 100)}</strong>
        </button>
      )}
    </main>
  )
}
