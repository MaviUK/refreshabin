import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const cuisineOptions = [
  'Pizza',
  'Burgers',
  'Chinese',
  'Indian',
  'Fish & Chips',
  'Kebab',
  'Cafe',
  'Desserts',
]

export default function Onboarding() {
  const [step, setStep] = useState(0)
  const [restaurantName, setRestaurantName] = useState('')
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([])
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const totalSteps = 6
  const progress = useMemo(() => Math.round(((step + 1) / totalSteps) * 100), [step])

  function next(event?: FormEvent) {
    event?.preventDefault()
    setError('')
    setStep((current) => Math.min(current + 1, totalSteps - 1))
  }

  function previous() {
    setError('')
    setStep((current) => Math.max(current - 1, 0))
  }

  function toggleCuisine(cuisine: string) {
    setSelectedCuisines((current) =>
      current.includes(cuisine)
        ? current.filter((item) => item !== cuisine)
        : [...current, cuisine],
    )
  }

  async function completeOnboarding(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)

    const { data, error: rpcError } = await supabase.rpc('create_restaurant_onboarding', {
      restaurant_name: restaurantName.trim(),
      restaurant_cuisines: selectedCuisines,
      contact_email: email.trim(),
      contact_phone: phone.trim(),
      address_line1: line1.trim(),
      address_line2: line2.trim(),
      address_city: city.trim(),
      address_postcode: postcode.trim(),
    })

    setSaving(false)

    if (rpcError) {
      setError(rpcError.message || 'We could not create your restaurant. Please try again.')
      return
    }

    setRestaurantId(data as string)
    setStep(totalSteps - 1)
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <Link className="brand" to="/dashboard">ordered.food</Link>
        <span>Step {step + 1} of {totalSteps}</span>
      </header>

      <div className="onboarding-progress" aria-label={`${progress}% complete`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <section className="onboarding-card">
        {step === 0 && (
          <div className="onboarding-step onboarding-welcome">
            <span className="onboarding-icon" aria-hidden="true">👋</span>
            <span className="eyebrow">Welcome to ordered.food</span>
            <h1>Let's get your restaurant online.</h1>
            <p>We will guide you through the essentials and create your restaurant workspace.</p>
            <button className="primary-button" type="button" onClick={() => next()}>Get started</button>
          </div>
        )}

        {step === 1 && (
          <form className="onboarding-step" onSubmit={next}>
            <span className="eyebrow">Restaurant details</span>
            <h1>What's your restaurant called?</h1>
            <p>This is the name customers will see when they browse and order.</p>
            <label className="large-field">
              Restaurant name
              <input
                autoFocus
                value={restaurantName}
                onChange={(event) => setRestaurantName(event.target.value)}
                placeholder="For example, The Pizza House"
                required
              />
            </label>
            <div className="onboarding-actions">
              <button className="text-button" type="button" onClick={previous}>Back</button>
              <button className="primary-button" type="submit">Continue</button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <span className="eyebrow">Cuisine</span>
            <h1>What kind of food do you serve?</h1>
            <p>Select all that apply. You can change these later.</p>
            <div className="cuisine-grid">
              {cuisineOptions.map((cuisine) => {
                const selected = selectedCuisines.includes(cuisine)
                return (
                  <button
                    className={selected ? 'cuisine-chip selected' : 'cuisine-chip'}
                    type="button"
                    key={cuisine}
                    onClick={() => toggleCuisine(cuisine)}
                    aria-pressed={selected}
                  >
                    {selected ? '✓ ' : ''}{cuisine}
                  </button>
                )
              })}
            </div>
            <div className="onboarding-actions">
              <button className="text-button" type="button" onClick={previous}>Back</button>
              <button className="primary-button" type="button" onClick={() => next()} disabled={!selectedCuisines.length}>Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <form className="onboarding-step" onSubmit={next}>
            <span className="eyebrow">Main location</span>
            <h1>Where can customers find you?</h1>
            <p>We will add Google Places search here next. For now, enter the trading address.</p>
            <div className="form-grid">
              <label className="large-field full-width">
                Address line 1
                <input value={line1} onChange={(event) => setLine1(event.target.value)} placeholder="12 High Street" required />
              </label>
              <label className="large-field full-width">
                Address line 2 <span className="optional-label">Optional</span>
                <input value={line2} onChange={(event) => setLine2(event.target.value)} placeholder="Unit, building or area" />
              </label>
              <label className="large-field">
                Town or city
                <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Bangor" required />
              </label>
              <label className="large-field">
                Postcode
                <input value={postcode} onChange={(event) => setPostcode(event.target.value.toUpperCase())} placeholder="BT20 5AA" required />
              </label>
            </div>
            <div className="onboarding-actions">
              <button className="text-button" type="button" onClick={previous}>Back</button>
              <button className="primary-button" type="submit">Continue</button>
            </div>
          </form>
        )}

        {step === 4 && (
          <form className="onboarding-step" onSubmit={completeOnboarding}>
            <span className="eyebrow">Contact details</span>
            <h1>How should we contact the restaurant?</h1>
            <p>These details are for account and order communication. They can be edited later.</p>
            <div className="form-grid">
              <label className="large-field">
                Email address
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="orders@restaurant.co.uk" />
              </label>
              <label className="large-field">
                Phone number
                <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="028 9000 0000" />
              </label>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="onboarding-actions">
              <button className="text-button" type="button" onClick={previous} disabled={saving}>Back</button>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? 'Creating restaurant…' : 'Create restaurant'}
              </button>
            </div>
          </form>
        )}

        {step === 5 && (
          <div className="onboarding-step onboarding-welcome">
            <span className="onboarding-icon" aria-hidden="true">🎉</span>
            <span className="eyebrow">Restaurant created</span>
            <h1>{restaurantName || 'Your restaurant'} is ready.</h1>
            <p>Your restaurant, owner membership and primary location have been saved securely.</p>
            {restaurantId && <div className="success-reference">Workspace created successfully</div>}
            <button className="primary-button" type="button" onClick={() => navigate('/dashboard')}>Go to dashboard</button>
          </div>
        )}
      </section>
    </main>
  )
}
