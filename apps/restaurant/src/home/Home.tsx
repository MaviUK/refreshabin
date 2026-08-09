import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Home.css'
import './HomeHeader.css'
import './HomeSearch.css'

const cuisines = ['Pizza', 'Burgers', 'Chinese', 'Indian', 'Chicken', 'Desserts']

type GeolocationErrorCode = 1 | 2 | 3
type SearchMode = 'postcode' | 'restaurant'

function locationErrorMessage(code?: GeolocationErrorCode) {
  if (code === 1) return 'Location access was denied. Enter your postcode instead.'
  if (code === 2) return 'We could not determine your location. Enter your postcode instead.'
  if (code === 3) return 'Finding your location took too long. Enter your postcode instead.'
  return 'We could not use your current location. Enter your postcode instead.'
}

async function reverseGeocodePostcode(latitude: number, longitude: number) {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&addressdetails=1`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Reverse geocoding failed')

  const result = await response.json() as { address?: { postcode?: string } }
  const postcode = result.address?.postcode?.trim()
  if (!postcode) throw new Error('No postcode returned for current location')
  return postcode
}

function OrderedLogo() {
  return (
    <span className="ordered-logo" aria-label="ordered.food">
      <span className="ordered-logo-top">ordered</span>
      <span className="ordered-logo-bottom"><span>.</span>food</span>
    </span>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [searchMode, setSearchMode] = useState<SearchMode>('postcode')
  const [searchValue, setSearchValue] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const value = searchValue.trim()
    if (searchMode === 'restaurant') {
      navigate(value ? `/restaurants?search=${encodeURIComponent(value)}` : '/restaurants')
      return
    }
    navigate(value ? `/restaurants?postcode=${encodeURIComponent(value)}` : '/restaurants')
  }

  function chooseSearchMode(mode: SearchMode) {
    setSearchMode(mode)
    setSearchValue('')
    setLocationError('')
  }

  function useCurrentLocation() {
    if (locating) return
    setLocationError('')

    if (!('geolocation' in navigator)) {
      setLocationError('Your browser does not support location lookup. Enter your postcode instead.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const resolvedPostcode = await reverseGeocodePostcode(coords.latitude, coords.longitude)
          setSearchValue(resolvedPostcode)
          navigate(`/restaurants?postcode=${encodeURIComponent(resolvedPostcode)}`)
        } catch (error) {
          console.error('Unable to reverse geocode current location', error)
          setLocationError('We found your location but could not resolve a postcode. Enter it manually instead.')
          setLocating(false)
        }
      },
      (error) => {
        setLocationError(locationErrorMessage(error.code as GeolocationErrorCode))
        setLocating(false)
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,
      },
    )
  }

  return (
    <main className="home-page">
      <header className="home-header-shell">
        <div className="home-header">
          <Link className="home-logo" to="/" aria-label="ordered.food home">
            <OrderedLogo />
          </Link>
          <nav className="home-nav" aria-label="Main navigation">
            <Link className="home-customer-link" to="/account">My account</Link>
            <Link className="home-restaurant-login" to="/login">Restaurant login</Link>
            <Link className="home-business-button" to="/register">List your business</Link>
          </nav>
        </div>
      </header>

      <section className="home-search-section" aria-label="Find food">
        <div className="home-search-inner">
          <div className="home-search-heading">
            <span className="home-eyebrow">Find food near you</span>
            <h2>What are you looking for?</h2>
          </div>

          <div className="home-search-tabs" role="tablist" aria-label="Search type">
            <button type="button" role="tab" aria-selected={searchMode === 'postcode'} className={searchMode === 'postcode' ? 'active' : ''} onClick={() => chooseSearchMode('postcode')}>Postcode</button>
            <button type="button" role="tab" aria-selected={searchMode === 'restaurant'} className={searchMode === 'restaurant' ? 'active' : ''} onClick={() => chooseSearchMode('restaurant')}>Restaurant</button>
          </div>

          <form className="home-discovery-search" onSubmit={submitSearch}>
            <input
              id="home-search"
              name="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={searchMode === 'postcode' ? 'Enter your postcode, e.g. BT20 5ED' : 'Search restaurant name'}
              aria-label={searchMode === 'postcode' ? 'Enter your postcode' : 'Search restaurant name'}
              autoComplete={searchMode === 'postcode' ? 'postal-code' : 'off'}
            />
            <button type="submit">{searchMode === 'postcode' ? 'Find food' : 'Search'}</button>
          </form>

          {searchMode === 'postcode' && (
            <button className="current-location-button home-location-button" type="button" onClick={useCurrentLocation} disabled={locating} aria-busy={locating}>
              <span aria-hidden="true">⌖</span>
              {locating ? 'Finding your location…' : 'Use my current location'}
            </button>
          )}
          {locationError && <p className="location-error" role="alert">{locationError}</p>}
        </div>
      </section>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-eyebrow">Your local favourites, delivered</span>
          <h1>Good food.<br />Ordered simply.</h1>
          <p>Discover independent restaurants near you, order in a few taps and support the places that make your area taste better.</p>

          <div className="home-trust-row">
            <span>Local restaurants</span>
            <span>Secure checkout</span>
            <span>Delivery or collection</span>
          </div>
        </div>

        <div className="home-hero-art" aria-hidden="true">
          <div className="hero-food-card hero-card-one">
            <span>Popular nearby</span>
            <strong>Smash & Stack</strong>
            <small>20–30 min · £2.49 delivery</small>
          </div>
          <div className="hero-dish">🍔</div>
          <div className="hero-food-card hero-card-two">
            <span>Your order</span>
            <strong>2 items · £18.40</strong>
            <small>Ready to checkout</small>
          </div>
        </div>
      </section>

      <section className="cuisine-section">
        <div className="section-heading">
          <div>
            <span className="home-eyebrow">What are you craving?</span>
            <h2>Browse by cuisine</h2>
          </div>
          <Link to="/restaurants">View all restaurants</Link>
        </div>

        <div className="cuisine-grid">
          {cuisines.map((cuisine, index) => (
            <Link key={cuisine} to={`/restaurants?cuisine=${encodeURIComponent(cuisine)}`}>
              <span>{['🍕', '🍔', '🥡', '🍛', '🍗', '🍰'][index]}</span>
              <strong>{cuisine}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="how-it-works">
        <div className="section-heading">
          <div>
            <span className="home-eyebrow">No fuss, just food</span>
            <h2>From hungry to happy</h2>
          </div>
        </div>

        <div className="steps-grid">
          <article><span>01</span><h3>Find somewhere great</h3><p>Search your area and discover local restaurants available for delivery or collection.</p></article>
          <article><span>02</span><h3>Make it yours</h3><p>Choose your meal, add extras, remove ingredients and leave a note for the kitchen.</p></article>
          <article><span>03</span><h3>Order securely</h3><p>Pay online and receive clear updates while the restaurant prepares your food.</p></article>
        </div>
      </section>

      <section className="business-banner">
        <div>
          <span className="home-eyebrow">For restaurants</span>
          <h2>Your food. Your customers. Your brand.</h2>
          <p>Take online orders without losing your identity. Build your menu, manage orders and grow direct relationships with local customers.</p>
        </div>
        <Link to="/register">Start taking orders</Link>
      </section>

      <footer className="home-footer">
        <Link className="home-logo home-footer-logo" to="/" aria-label="ordered.food home"><OrderedLogo /></Link>
        <p>Online ordering for local restaurants.</p>
        <div><Link to="/account">My account</Link><Link to="/login">Restaurant login</Link><Link to="/register">Business sign up</Link></div>
      </footer>
    </main>
  )
}
