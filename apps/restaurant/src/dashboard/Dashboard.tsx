import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const setupSteps = [
  { label: 'Restaurant details', complete: true, to: '/onboarding' },
  { label: 'Address and contact details', complete: true, to: '/onboarding' },
  { label: 'Opening hours', complete: false, to: '/opening-hours' },
  { label: 'Add your first menu category', complete: false, to: '/menu' },
  { label: 'Add your first product', complete: false, to: '/menu' },
  { label: 'Connect payments', complete: false, to: '/onboarding#payments' },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const completeCount = setupSteps.filter((step) => step.complete).length
  const progress = Math.round((completeCount / setupSteps.length) * 100)

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <Link className="brand" to="/dashboard">ordered.food</Link>
          <p className="dashboard-kicker">Restaurant portal</p>
        </div>
        <button className="secondary-button" type="button" onClick={signOut}>Sign out</button>
      </header>

      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">Your restaurant</span>
          <h1>Good evening 👋</h1>
          <p>Finish your setup, build your menu and get ready to accept your first order.</p>
        </div>
        <Link className="primary-button button-link" to="/onboarding">Continue setup</Link>
      </section>

      <section className="metrics-grid" aria-label="Restaurant summary">
        <article className="metric-card">
          <span>Restaurant status</span>
          <strong className="status-value"><i className="status-dot" /> Setup mode</strong>
        </article>
        <article className="metric-card">
          <span>Today's orders</span>
          <strong>0</strong>
        </article>
        <article className="metric-card">
          <span>Open orders</span>
          <strong>0</strong>
        </article>
        <article className="metric-card">
          <span>Revenue today</span>
          <strong>£0.00</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel-card setup-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Launch checklist</span>
              <h2>Your setup progress</h2>
            </div>
            <strong>{progress}%</strong>
          </div>

          <div className="progress-track" aria-label={`${progress}% complete`}>
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="checklist">
            {setupSteps.map((step) => (
              <Link className="checklist-row" key={step.label} to={step.to}>
                <span className={step.complete ? 'check-icon complete' : 'check-icon'}>
                  {step.complete ? '✓' : '○'}
                </span>
                <span>{step.label}</span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Quick actions</span>
              <h2>Build your restaurant</h2>
            </div>
          </div>

          <div className="quick-actions">
            <Link to="/orders">Manage orders <span>→</span></Link>
            <Link to="/kds">Open kitchen display <span>→</span></Link>
            <Link to="/printers">Manage printers <span>→</span></Link>
            <Link to="/print-history">View print history <span>→</span></Link>
            <Link to="/onboarding">Complete restaurant setup <span>→</span></Link>
            <Link to="/menu">Build your menu <span>→</span></Link>
            <Link to="/opening-hours">Set opening hours <span>→</span></Link>
          </div>
        </article>
      </section>
    </main>
  )
}
