import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

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
      supabase
        .from('restaurant_members')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle(),
      supabase.rpc('get_my_restaurant_group_context'),
    ])

    setLoading(false)
    const hasGroupAccess = Array.isArray(groupContext) && groupContext.length > 0
    navigate(membership ? '/dashboard' : hasGroupAccess ? '/enterprise' : '/dashboard', { replace: true })
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand" to="/">ordered.food</Link>
        <span className="eyebrow">Restaurant portal</span>
        <h1>Welcome back</h1>
        <p>Sign in to manage your restaurant, menu and incoming orders.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/forgot-password">Forgot password?</Link>
          <span>New to ordered.food? <Link to="/register">Create an account</Link></span>
        </div>
      </section>
    </main>
  )
}
