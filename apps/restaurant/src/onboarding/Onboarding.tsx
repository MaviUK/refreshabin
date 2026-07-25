import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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
  const navigate = useNavigate()
  const totalSteps = 4
  const progress = useMemo(() => Math.round(((step + 1) / totalSteps) * 100), [step])

  function next(event?: FormEvent) {
    event?.preventDefault()
    setStep((current) => Math.min(current + 1, totalSteps - 1))
  }

  function previous() {
    setStep((current) => Math.max(current - 1, 0))
  }

  function toggleCuisine(cuisine: string) {
    setSelectedCuisines((current) =>
      current.includes(cuisine)
        ? current.filter((item) => item !== cuisine)
        : [...current, cuisine],
    )
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
            <p>We will guide you through the essentials. It should only take a few minutes.</p>
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
          <div className="onboarding-step onboarding-welcome">
            <span className="onboarding-icon" aria-hidden="true">🎉</span>
            <span className="eyebrow">Great start</span>
            <h1>{restaurantName || 'Your restaurant'} is taking shape.</h1>
            <p>Next we will connect the address, contact details, logo and opening hours to Supabase.</p>
            <button className="primary-button" type="button" onClick={() => navigate('/dashboard')}>Go to dashboard</button>
          </div>
        )}
      </section>
    </main>
  )
}
