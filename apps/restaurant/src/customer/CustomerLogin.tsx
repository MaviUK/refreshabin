import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'

function safeDestination(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account'
  return value
}

export default function CustomerLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const destination = useMemo(() => {
    const stateDestination = (location.state as { from?: string } | null)?.from
    return safeDestination(stateDestination || searchParams.get('redirect'))
  }, [location.state, searchParams])

  useEffect(() => {
    async function redirectSignedInCustomer() {
      const { data } = await supabase.auth.getSession()
      if (data.session) navigate(destination, { replace: true })
    }
    void redirectSignedInCustomer()
  }, [destination, navigate])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setLoading(false)
      setError(signInError.message)
      return
    }

    await supabase.rpc('claim_customer_orders')
    setLoading(false)
    navigate(destination, { replace: true })
  }

  return (
    <main className="customer-account-shell">
      <section className="customer-account-card customer-account-card--narrow">
        <Link className="customer-account-brand" to="/">ordered.food</Link>
        <span className="customer-account-eyebrow">Customer account</span>
        <h1>Sign in</h1>
        <p>View your orders and use your saved details at checkout.</p>

        <form className="customer-account-form" onSubmit={handleSubmit}>
          <label>
            Email address
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error && <div className="customer-account-error" role="alert">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <p className="customer-account-note">New customer? <Link to="/account/register" state={{ from: destination }}>Create an account</Link></p>
      </section>
    </main>
  )
}
