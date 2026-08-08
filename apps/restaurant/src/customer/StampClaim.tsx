import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './StampClaim.css'

type ClaimResult = { current_stamps: number; stamps_required: number; completed_cycles: number; reward_issued: boolean; stamps_awarded: number }

export default function StampClaim() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<ClaimResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        navigate(`/account/login?returnTo=${encodeURIComponent(`/account/stamps/claim?token=${token}`)}`, { replace: true })
        return
      }
      if (!token) { setError('This stamp claim link is incomplete.'); setLoading(false); return }
      const { data, error } = await supabase.rpc('claim_stamp_qr', { p_token: token })
      if (!active) return
      if (error) setError(error.message)
      else setResult(data as ClaimResult)
      setLoading(false)
    })()
    return () => { active = false }
  }, [navigate, token])

  if (loading) return <main className="stamp-claim-page"><section><div className="stamp-claim-spinner"/><h1>Claiming your stamp…</h1><p>We are checking this secure restaurant link.</p></section></main>

  return <main className="stamp-claim-page"><section className={error ? 'error' : 'success'}>
    <span>{error ? 'Unable to claim' : 'Stamp added'}</span>
    <h1>{error ? 'This claim could not be completed.' : `You earned ${result?.stamps_awarded || 0} stamp${result?.stamps_awarded === 1 ? '' : 's'}!`}</h1>
    {error ? <p>{error}</p> : <><div className="stamp-claim-progress"><strong>{result?.current_stamps || 0} / {result?.stamps_required || 0}</strong><div><i style={{ width: `${Math.min(100, ((result?.current_stamps || 0) / Math.max(result?.stamps_required || 1, 1)) * 100)}%` }}/></div></div>{result?.reward_issued && <div className="stamp-claim-reward">🎉 Your completed-card reward is now in your rewards wallet.</div>}</>}
    <div className="stamp-claim-actions"><Link to="/account/stamps">View stamp cards</Link><Link to="/restaurants">Find food</Link></div>
  </section></main>
}
