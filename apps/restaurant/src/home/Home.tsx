import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { featuredFoodCategories, foodCategories } from '../lib/foodCategories'
import { supabase } from '../lib/supabase'
import './Home.css'
import './HomeHeader.css'
import './HomeSearch.css'

const cuisineIcons: Record<string, string> = {
  Pizza: '🍕', Burgers: '🍔', Chicken: '🍗', Chinese: '🥡', Indian: '🍛',
  'Fish & Chips': '🐟', Kebab: '🥙', Italian: '🍝', Thai: '🍜', Japanese: '🍣',
  Sushi: '🍣', Mexican: '🌮', Breakfast: '🍳', Brunch: '🥞', Desserts: '🍰',
  'Ice Cream': '🍦', Healthy: '🥗', Vegan: '🌱', Vegetarian: '🥬', Bakery: '🥐',
  Coffee: '☕', 'Bubble Tea': '🧋', Seafood: '🦐', BBQ: '🍖', Steak: '🥩',
  Wings: '🍗', 'Fried Chicken': '🍗', Pasta: '🍝', Sandwiches: '🥪', Wraps: '🌯',
}

function categoryCards(categories: string[]) {
  return categories.map((name) => ({ name, icon: cuisineIcons[name] ?? '🍽️' }))
}

type GeolocationErrorCode = 1 | 2 | 3
type SearchMode = 'postcode' | 'restaurant'

function locationErrorMessage(code?: GeolocationErrorCode) {
  if (code === 1) return 'Location access was denied. Enter your postcode instead.'
  if (code === 2) return 'We could not determine your location. Enter your postcode instead.'
  if (code === 3) return 'Finding your location took too long. Enter your postcode instead.'
  return 'We could not use your current location. Enter your postcode instead.'
}

async function reverseGeocodePostcode(latitude: number, longitude: number) {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&addressdetails=1`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Reverse geocoding failed')
  const result = await response.json() as { address?: { postcode?: string } }
  const postcode = result.address?.postcode?.trim()
  if (!postcode) throw new Error('No postcode returned for current location')
  return postcode
}

function OrderedLogo() {
  return <span className="ordered-logo" aria-label="ordered.food"><span className="ordered-logo-top">ordered</span><span className="ordered-logo-bottom"><span>.</span>food</span></span>
}

export default function Home() {
  const navigate = useNavigate()
  const [searchMode, setSearchMode] = useState<SearchMode>('postcode')
  const [searchValue, setSearchValue] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [defaultPostcode, setDefaultPostcode] = useState('')
  const [showAllCategories, setShowAllCategories] = useState(false)
  const visibleCuisines = categoryCards(showAllCategories ? foodCategories : featuredFoodCategories)

  useEffect(() => {
    let active = true
    async function loadDefaultPostcode() {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) { if (active) setDefaultPostcode(''); return }
      const { data } = await supabase.from('customer_addresses').select('postcode').eq('user_id', user.id).eq('is_default', true).maybeSingle()
      if (active) setDefaultPostcode((data?.postcode as string | undefined)?.trim() ?? '')
    }
    void loadDefaultPostcode()
    const { data: authListener } = supabase.auth.onAuthStateChange(() => void loadDefaultPostcode())
    return () => { active = false; authListener.subscription.unsubscribe() }
  }, [])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const value = searchValue.trim()
    if (searchMode === 'restaurant') { navigate(value ? `/restaurants?search=${encodeURIComponent(value)}` : '/restaurants'); return }
    navigate(value ? `/restaurants?postcode=${encodeURIComponent(value)}` : '/restaurants')
  }

  function chooseSearchMode(mode: SearchMode) {
    setSearchMode(mode)
    setSearchValue(mode === 'postcode' && defaultPostcode ? defaultPostcode : '')
    setLocationError('')
  }

  function cuisineHref(cuisine: string) {
    const params = new URLSearchParams({ cuisine })
    if (defaultPostcode) params.set('postcode', defaultPostcode)
    return `/restaurants?${params.toString()}`
  }

  function useCurrentLocation() {
    if (locating) return
    setLocationError('')
    if (!('geolocation' in navigator)) { setLocationError('Your browser does not support location lookup. Enter your postcode instead.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const resolvedPostcode = await reverseGeocodePostcode(coords.latitude, coords.longitude)
        setSearchValue(resolvedPostcode)
        navigate(`/restaurants?postcode=${encodeURIComponent(resolvedPostcode)}`)
      } catch (error) {
        console.error('Unable to reverse geocode current location', error)
        setLocationError('We found your location but could not resolve a postcode. Enter it manually instead.')
        setLocating(false)
      }
    }, (error) => { setLocationError(locationErrorMessage(error.code as GeolocationErrorCode)); setLocating(false) }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 })
  }

  return (
    <main className="home-page">
      <header className="home-header-shell"><div className="home-header"><Link className="home-logo" to="/" aria-label="ordered.food home"><OrderedLogo /></Link><nav className="home-nav" aria-label="Customer navigation"><Link to="/restaurants">Browse food</Link><Link className="home-customer-link" to="/account">My account</Link></nav></div></header>

      <section className="home-search-section" aria-label="Find food"><div className="home-search-inner">
        <div className="home-search-heading"><span className="home-eyebrow">Find food near you</span></div>
        <div className="home-search-tabs" role="tablist" aria-label="Search type"><button type="button" role="tab" aria-selected={searchMode === 'postcode'} className={searchMode === 'postcode' ? 'active' : ''} onClick={() => chooseSearchMode('postcode')}>Postcode</button><button type="button" role="tab" aria-selected={searchMode === 'restaurant'} className={searchMode === 'restaurant' ? 'active' : ''} onClick={() => chooseSearchMode('restaurant')}>Restaurant</button></div>
        <form className="home-discovery-search" onSubmit={submitSearch}><div className="home-search-input-wrap">{searchMode === 'postcode' && <button className="home-inline-location-button" type="button" onClick={useCurrentLocation} disabled={locating} aria-label={locating ? 'Finding your current location' : 'Use my current location'}><span aria-hidden="true">⌖</span></button>}<input id="home-search" name="search" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder={searchMode === 'postcode' ? 'Enter postcode, e.g. BT20 5ED' : 'Search restaurant name'} aria-label={searchMode === 'postcode' ? 'Enter your postcode' : 'Search restaurant name'} autoComplete={searchMode === 'postcode' ? 'postal-code' : 'off'} className={searchMode === 'postcode' ? 'has-location-button' : ''} /></div><button className="home-search-submit" type="submit">{searchMode === 'postcode' ? 'Find food' : 'Search'}</button></form>
        {locationError && <p className="location-error" role="alert">{locationError}</p>}
        <div className="home-cuisine-strip-heading"><div><strong>Browse food</strong>{defaultPostcode && <span>Near {defaultPostcode}</span>}</div><button className="home-view-all-cuisines" type="button" onClick={() => setShowAllCategories((current) => !current)} aria-expanded={showAllCategories}>{showAllCategories ? 'Show popular' : 'View all'}</button></div>
        <div className={showAllCategories ? 'home-cuisine-carousel expanded' : 'home-cuisine-carousel'} aria-label={showAllCategories ? 'All food types' : 'Popular food types'}>{visibleCuisines.map((cuisine) => <Link key={cuisine.name} to={cuisineHref(cuisine.name)} className="home-cuisine-card"><span className="home-cuisine-icon" aria-hidden="true">{cuisine.icon}</span><strong>{cuisine.name}</strong></Link>)}</div>
      </div></section>

      <section className="home-hero home-hero-compact">
        <div className="home-hero-copy"><span className="home-eyebrow">Local food, made easy</span><h1>Hungry?<br />Let’s eat.</h1><p>Find local restaurants, order your favourites and choose delivery or collection.</p><div className="home-trust-row"><span>Local</span><span>Secure</span><span>Easy</span></div></div>
        <div className="home-hero-art home-hero-art-compact" aria-hidden="true"><div className="hero-dish">🍔</div><div className="hero-food-card hero-card-one"><strong>Local favourites</strong><small>Ready to order</small></div></div>
      </section>

      <section className="how-it-works how-it-works-compact"><div className="section-heading"><div><span className="home-eyebrow">Three simple steps</span><h2>Order in minutes</h2></div></div><div className="steps-grid"><article><span>01</span><h3>Find</h3><p>Choose a local restaurant.</p></article><article><span>02</span><h3>Pick</h3><p>Add your food and extras.</p></article><article><span>03</span><h3>Order</h3><p>Pay securely and track it.</p></article></div></section>

      <section className="business-banner restaurant-access"><div><span className="home-eyebrow">Restaurant partners</span><h2>Own or manage a restaurant?</h2><p>Join ordered.food to take direct orders, or sign in to manage your existing restaurant.</p></div><div className="restaurant-access-actions"><Link className="restaurant-signup-button" to="/register">Restaurant sign up</Link><Link className="restaurant-login-button" to="/login">Restaurant login</Link></div></section>
      <footer className="home-footer"><Link className="home-logo home-footer-logo" to="/" aria-label="ordered.food home"><OrderedLogo /></Link><p>Find and order from local restaurants.</p><div><Link to="/restaurants">Browse food</Link><Link to="/account">My account</Link><Link to="/account/orders">My orders</Link></div></footer>
    </main>
  )
}
