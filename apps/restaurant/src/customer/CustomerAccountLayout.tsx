import { Link, Outlet } from 'react-router-dom'
import CustomerNotificationBell from './CustomerNotificationBell'
import './CustomerAccountLayout.css'

function OrderedLogo() {
  return <img className="customer-site-logo-mark" src="/ordered-food-logo.jpg" alt="ordered.food" />
}

export default function CustomerAccountLayout() {
  return (
    <div className="customer-site-account-layout">
      <header className="customer-site-header-shell">
        <div className="customer-site-header">
          <Link className="customer-site-logo" to="/" aria-label="ordered.food home">
            <OrderedLogo />
          </Link>
          <nav className="customer-site-nav" aria-label="Customer navigation">
            <Link to="/restaurants">Browse food</Link>
            <CustomerNotificationBell />
            <Link className="customer-site-account-link" to="/account">My account</Link>
          </nav>
        </div>
      </header>
      <div className="customer-site-account-content">
        <Outlet />
      </div>
    </div>
  )
}
