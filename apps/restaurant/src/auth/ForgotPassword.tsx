import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setSent(true)
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand" to="/">ordered.food</Link>
        <span className="eyebrow">Account recovery</span>
        <h1>Reset your password</h1>
        <p>Enter your email address and we will send you a secure reset link.</p>

        {sent ? (
          <div className="success-panel" role="status">
            Check your inbox for the password reset email.
          </div>
        ) : (
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

            {error && <div className="form-error" role="alert">{error}</div>}

            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="auth-links">
          <Link to="/login">Back to sign in</Link>
        </div>
      </section>
    </main>
  )
}
