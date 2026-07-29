import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerAccount.css'

export default function CustomerForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/account/reset-password`,
    })

    setLoading(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setSent(true)
  }

  return (
    <main className="customer-account-shell">
      <section className="customer-account-card customer-account-card--narrow">
        <Link className="customer-account-brand" to="/restaurants">ordered.food</Link>
        <span className="customer-account-eyebrow">Customer account</span>
        <h1>Reset your password</h1>
        <p>Enter your email address and we will send you a secure password reset link.</p>

        {sent ? (
          <div className="customer-account-success" role="status">
            Check your inbox for a password reset email. You can close this page once it arrives.
          </div>
        ) : (
          <form className="customer-account-form" onSubmit={handleSubmit}>
            <label>
              Email address
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            </label>
            {error && <div className="customer-account-error" role="alert">{error}</div>}
            <button type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
          </form>
        )}

        <p className="customer-account-note"><Link to="/account/login">← Back to sign in</Link></p>
      </section>
    </main>
  )
}
