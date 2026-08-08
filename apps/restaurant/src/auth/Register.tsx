import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
      },
    })

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    navigate(data.session ? '/dashboard' : '/login', {
      replace: true,
      state: data.session ? undefined : { message: 'Check your email to confirm your account.' },
    })
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand" to="/">ordered.food</Link>
        <span className="eyebrow">Restaurant signup</span>
        <h1>Create your account</h1>
        <p>Set up your restaurant portal and start building your listing.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Your name
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </label>
          <label>
            Email address
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="auth-links">
          <span>Already registered? <Link to="/login">Sign in</Link></span>
        </div>
      </section>
    </main>
  )
}
