import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Mode = 'sign-in' | 'activate'

export default function Login() {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: string; accessDenied?: boolean; passwordReset?: boolean } | null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    if (mode === 'activate') {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
      })
      if (signUpError) {
        setError(signUpError.message)
      } else if (!data.session) {
        setMessage('Check your email to verify the account, then return here to sign in.')
      } else {
        const { error: claimError } = await supabase.rpc('claim_platform_admin_access')
        if (claimError) {
          await supabase.auth.signOut()
          setError('This verified email has not been authorised for platform administration.')
        } else {
          navigate('/', { replace: true })
        }
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        setError('Email or password not recognised.')
      } else {
        const { error: claimError } = await supabase.rpc('claim_platform_admin_access')
        if (claimError) {
          await supabase.auth.signOut()
          setError('This account is not authorised for platform administration.')
        } else {
          navigate(state?.from ?? '/', { replace: true })
        }
      }
    }

    setLoading(false)
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-intro">
        <div className="admin-auth-logo"><span>o.</span>ordered.food</div>
        <div>
          <span className="admin-kicker">Platform operations</span>
          <h1>The control room for ordered.food.</h1>
          <p>Review restaurants, monitor live operations and keep every administrative decision accountable.</p>
        </div>
        <small>Restricted access · Authorised administrators only</small>
      </section>

      <section className="admin-auth-panel">
        <div className="admin-auth-card">
          <span className="admin-kicker">Secure admin access</span>
          <h2>{mode === 'sign-in' ? 'Welcome back' : 'Activate your account'}</h2>
          <p>{mode === 'sign-in' ? 'Sign in with your platform administrator account.' : 'This only works for an email that has already been invited.'}</p>

          <div className="auth-mode-switch" role="tablist">
            <button type="button" className={mode === 'sign-in' ? 'active' : ''} onClick={() => { setMode('sign-in'); setError(''); setMessage('') }}>Sign in</button>
            <button type="button" className={mode === 'activate' ? 'active' : ''} onClick={() => { setMode('activate'); setError(''); setMessage('') }}>First access</button>
          </div>

          {state?.accessDenied && !error && <div className="admin-alert error">Your account does not have platform-admin access.</div>}
          {state?.passwordReset && !error && <div className="admin-alert success" role="status">Your password has been changed. Sign in with your new password.</div>}

          <form className="admin-auth-form" onSubmit={submit}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label>Password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required /></label>
            {mode === 'sign-in' && <div className="admin-auth-link-row"><Link to="/forgot-password">Forgot password?</Link></div>}
            {error && <div className="admin-alert error" role="alert">{error}</div>}
            {message && <div className="admin-alert success" role="status">{message}</div>}
            <button className="admin-primary-button" type="submit" disabled={loading}>{loading ? 'Please wait…' : mode === 'sign-in' ? 'Sign in securely' : 'Create admin account'}</button>
          </form>
        </div>
      </section>
    </main>
  )
}
