import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Login.css'

function OrderedLogo() {
  return (
    <span className="restaurant-login-logo" aria-label="ordered.food">
      <span className="restaurant-login-logo-top">ordered</span>
      <span className="restaurant-login-logo-bottom"><b>.</b>food</span>
    </span>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const requestedDestination = (location.state as { from?: string } | null)?.from

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setLoading(false)
      setError(signInError.message)
      return
    }

    if (requestedDestination) {
      setLoading(false)
      navigate(requestedDestination, { replace: true })
      return
    }

    const userId = signInData.user?.id
    if (!userId) {
      setLoading(false)
      navigate('/dashboard', { replace: true })
      return
    }

    const [{ data: membership }, { data: groupContext }] = await Promise.all([
      supabase.from('restaurant_members').select('id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle(),
      supabase.rpc('get_my_restaurant_group_context'),
    ])

    if (membership) {
      const { error: auditError } = await supabase.rpc('record_platform_sign_in', { p_actor_type: 'restaurant' })
      if (auditError) console.warn('Could not record restaurant sign-in', auditError)
    }

    setLoading(false)
    const hasGroupAccess = Array.isArray(groupContext) && groupContext.length > 0
    navigate(membership ? '/dashboard' : hasGroupAccess ? '/enterprise' : '/dashboard', { replace: true })
  }

  return (
    <main className="restaurant-login-page">
      <header className="restaurant-login-header">
        <Link to="/" aria-label="Back to ordered.food"><OrderedLogo /></Link>
        <Link className="restaurant-login-customer-link" to="/">Customer site</Link>
      </header>

      <section className="restaurant-login-layout">
        <div className="restaurant-login-copy">
          <span className="restaurant-login-kicker">Restaurant partners</span>
          <h1>Welcome back.</h1>
          <p>Manage orders, menus, customers and everything else from one place.</p>
          <div className="restaurant-login-benefits" aria-label="Restaurant portal features">
            <span>Live orders</span>
            <span>Menu control</span>
            <span>Customer tools</span>
          </div>
        </div>

        <section className="restaurant-login-card" aria-label="Restaurant sign in">
          <div className="restaurant-login-card-heading">
            <span>Restaurant login</span>
            <h2>Sign in</h2>
            <p>Use the email address linked to your restaurant account.</p>
          </div>

          <form className="restaurant-login-form" onSubmit={handleSubmit}>
            <label>
              <span>Email address</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            {error && <div className="restaurant-login-error" role="alert">{error}</div>}
            <button className="restaurant-login-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>

          <div className="restaurant-login-links">
            <Link to="/forgot-password">Forgot password?</Link>
            <span>New restaurant? <Link to="/register">Create an account</Link></span>
          </div>
        </section>
      </section>
    </main>
  )
}
