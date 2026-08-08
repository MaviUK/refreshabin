import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

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

    navigate('/dashboard', { replace: true })
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand" to="/">ordered.food</Link>
        <span className="eyebrow">Secure your account</span>
        <h1>Choose a new password</h1>
        <p>Use at least eight characters and avoid reusing an old password.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>
    </main>
  )
}
