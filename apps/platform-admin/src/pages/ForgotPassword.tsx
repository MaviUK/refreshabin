import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })

    if (resetError) {
      setError('We could not send a recovery email right now. Please wait a moment and try again.')
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-intro">
        <div className="admin-auth-logo"><span>o.</span>ordered.food</div>
        <div>
          <span className="admin-kicker">Account recovery</span>
          <h1>Get securely back into the control room.</h1>
          <p>We will send a single-use recovery link to your platform administrator email address.</p>
        </div>
        <small>Restricted access · Authorised administrators only</small>
      </section>

      <section className="admin-auth-panel">
        <div className="admin-auth-card">
          <span className="admin-kicker">Reset admin password</span>
          <h2>{sent ? 'Check your email' : 'Forgot password?'}</h2>
          {sent ? (
            <>
              <p>If an admin account exists for <strong>{email.trim()}</strong>, a recovery link has been sent. Use the newest email—the link can only be used once.</p>
              <div className="admin-auth-actions">
                <button className="admin-primary-button" type="button" onClick={() => setSent(false)}>Send another link</button>
                <Link className="admin-auth-back" to="/login">Back to sign in</Link>
              </div>
            </>
          ) : (
            <>
              <p>Enter the email address used for your platform administrator account.</p>
              <form className="admin-auth-form auth-recovery-form" onSubmit={submit}>
                <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required autoFocus /></label>
                {error && <div className="admin-alert error" role="alert">{error}</div>}
                <button className="admin-primary-button" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send recovery email'}</button>
                <Link className="admin-auth-back" to="/login">Back to sign in</Link>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
