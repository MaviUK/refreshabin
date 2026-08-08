import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'

export default function CustomerResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [checkingSession, setCheckingSession] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function checkRecoverySession() {
      const { data } = await supabase.auth.getSession()
      if (!data.session) setError('This reset link is invalid or has expired. Request a new one to continue.')
      setCheckingSession(false)
    }
    void checkRecoverySession()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Your password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    navigate('/account', { replace: true })
  }

  if (checkingSession) return <main className="customer-account-shell"><section className="customer-account-card customer-account-card--narrow"><p>Checking your reset link…</p></section></main>

  return (
    <main className="customer-account-shell">
      <section className="customer-account-card customer-account-card--narrow">
        <Link className="customer-account-brand" to="/restaurants">ordered.food</Link>
        <span className="customer-account-eyebrow">Customer account</span>
        <h1>Choose a new password</h1>
        <p>Use at least eight characters and avoid reusing an old password.</p>

        <form className="customer-account-form" onSubmit={handleSubmit}>
          <label>
            New password
            <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <label>
            Confirm new password
            <input type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          {error && <div className="customer-account-error" role="alert">{error}</div>}
          <button type="submit" disabled={loading || error.includes('invalid or has expired')}>{loading ? 'Updating…' : 'Update password'}</button>
        </form>

        {error.includes('invalid or has expired') && <p className="customer-account-note"><Link to="/account/forgot-password">Request another reset link</Link></p>}
      </section>
    </main>
  )
}
