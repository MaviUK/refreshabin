import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import logoUrl from '../assets/ordered-food-logo.jpg'
import { supabase } from '../lib/supabase'
import CustomerNotificationBell from '../customer/CustomerNotificationBell'
import './CustomerSiteHeader.css'

type CustomerSiteHeaderProps = {
  showNotifications?: boolean
}

export default function CustomerSiteHeader({ showNotifications = false }: CustomerSiteHeaderProps) {
  const location = useLocation()
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session?.user))
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session?.user))
    })
    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const returnTo = `${location.pathname}${location.search}`

  return (
    <header className="customer-global-header-shell">
      <div className="customer-global-header">
        <Link className="customer-global-logo" to="/" aria-label="ordered.food home">
          <img src={logoUrl} alt="ordered.food" />
        </Link>
        <nav className="customer-global-nav" aria-label="Customer navigation">
          <Link className="customer-global-browse" to="/restaurants">Browse food</Link>
          {showNotifications && signedIn ? <CustomerNotificationBell /> : null}
          {signedIn ? (
            <Link className="customer-global-account" to="/account">My account</Link>
          ) : (
            <Link className="customer-global-account" to="/account/login" state={{ from: returnTo }}>Log in</Link>
          )}
        </nav>
      </div>
    </header>
  )
}
