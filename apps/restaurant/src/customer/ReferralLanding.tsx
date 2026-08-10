import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { claimPendingReferralAttribution, saveReferralAttribution } from './referralAttribution'
import './Referrals.css'

type ReferralOffer = {
  valid: boolean
  error?: string
  token?: string
  expires_at?: string
  restaurant_name?: string
  restaurant_slug?: string
  referee_reward?: string
}

export default function ReferralLanding() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [offer, setOffer] = useState<ReferralOffer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      if (!code) { setOffer({ valid: false, error: 'Referral link is invalid.' }); setLoading(false); return }
      const { data, error } = await supabase.rpc('create_referral_attribution', { p_code: code })
      if (!active) return
      if (error) { setOffer({ valid: false, error: error.message }); setLoading(false); return }
      const result = data as ReferralOffer
      setOffer(result)
      if (result.valid && result.token) {
        saveReferralAttribution({ token: result.token, expiresAt: result.expires_at, restaurantSlug: result.restaurant_slug })
        const claimed = await claimPendingReferralAttribution()
        if (claimed && !claimed.error && result.restaurant_slug) {
          navigate(`/r/${result.restaurant_slug}`, { replace: true })
          return
        }
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [code, navigate])

  if (loading) return <main className="referral-state">Preparing your referral…</main>
  if (!offer?.valid) return <main className="referral-state"><section><span>Referral</span><h1>This link is not available.</h1><p>{offer?.error || 'It may have expired or reached its limit.'}</p><Link to="/restaurants">Browse restaurants</Link></section></main>

  const redirect = offer.restaurant_slug ? `/r/${offer.restaurant_slug}` : '/restaurants'
  return <main className="referral-landing">
    <section className="referral-hero-card">
      <span>Friend referral</span>
      <h1>You have been invited to {offer.restaurant_name}.</h1>
      <p>Create or sign into your ordered.food account before ordering. Once you meet the referral terms, <strong>{offer.referee_reward}</strong> will be added automatically.</p>
      <div className="referral-actions">
        <Link className="primary" to="/account/register" state={{ from: redirect }}>Create account</Link>
        <Link to="/account/login" state={{ from: redirect }}>Sign in</Link>
      </div>
      <small>Your referral never changes checkout totals directly. Eligibility is checked securely after qualifying paid orders are completed.</small>
    </section>
  </main>
}
