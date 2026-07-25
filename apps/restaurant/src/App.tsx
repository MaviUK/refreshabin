import { Navigate, Route, Routes } from 'react-router-dom'

function HomePage() {
  return (
    <main className="app-shell">
      <section className="hero-card">
        <span className="eyebrow">Restaurant portal</span>
        <h1>Welcome to ordered.food</h1>
        <p>
          Your restaurant dashboard is being prepared. Next we will add sign-in,
          onboarding, opening hours and menu management.
        </p>
        <div className="status-row">
          <span className="status-dot" aria-hidden="true" />
          <span>Platform foundation is live</span>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
