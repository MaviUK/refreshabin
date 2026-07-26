import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import './Home.css'

const cuisines = ['Pizza', 'Burgers', 'Chinese', 'Indian', 'Chicken', 'Desserts']

export default function Home() {
  const navigate = useNavigate()
  const [postcode, setPostcode] = useState('')

  function submitPostcode(event: FormEvent) {
    event.preventDefault()
    const value = postcode.trim()
    navigate(value ? `/restaurants?postcode=${encodeURIComponent(value)}` : '/restaurants')
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <Link className="home-logo" to="/">ordered.food</Link>
        <nav className="home-nav" aria-label="Main navigation">
          <Link to="/login">Restaurant login</Link>
          <Link className="home-business-button" to="/register">List your business</Link>
        </nav>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-eyebrow">Your local favourites, delivered</span>
          <h1>Good food.<br />Ordered simply.</h1>
          <p>Discover independent restaurants near you, order in a few taps and support the places that make your area taste better.</p>

          <form className="postcode-search" onSubmit={submitPostcode}>
            <label htmlFor="postcode">Enter your postcode</label>
            <div>
              <input
                id="postcode"
                name="postcode"
                value={postcode}
                onChange={(event) => setPostcode(event.target.value)}
                placeholder="e.g. BT20 5ED"
                autoComplete="postal-code"
              />
              <button type="submit">Find food</button>
            </div>
          </form>

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
        <Link className="home-logo" to="/">ordered.food</Link>
        <p>Online ordering for local restaurants.</p>
        <div><Link to="/login">Restaurant login</Link><Link to="/register">Business sign up</Link></div>
      </footer>
    </main>
  )
}
