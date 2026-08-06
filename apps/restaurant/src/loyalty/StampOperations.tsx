import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './StampOperations.css'

type Program = { id: string; name: string; is_active: boolean }
type QrCampaign = { id: string; program_id: string; program_name: string; stamps_awarded: number; claim_count: number; max_claims: number; expires_at: string; is_active: boolean }
type Claim = { id: string; program_name: string; customer_user_id: string; stamps_awarded: number; claimed_at: string }
type Activity = { active_qr_campaigns: QrCampaign[]; recent_claims: Claim[] }
type CreatedQr = { campaign_id: string; token: string; expires_at: string; claim_url: string }

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export default function StampOperations() {
  const [programs, setPrograms] = useState<Program[]>([])
  const [activity, setActivity] = useState<Activity>({ active_qr_campaigns: [], recent_claims: [] })
  const [programId, setProgramId] = useState('')
  const [stamps, setStamps] = useState('1')
  const [maxClaims, setMaxClaims] = useState('1')
  const [validMinutes, setValidMinutes] = useState('10')
  const [createdQr, setCreatedQr] = useState<CreatedQr | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [manualStamps, setManualStamps] = useState('1')
  const [manualNote, setManualNote] = useState('In-store purchase')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    const [{ data: dashboard }, { data: claimData, error }] = await Promise.all([
      supabase.rpc('get_restaurant_stamp_programs'),
      supabase.rpc('get_restaurant_stamp_claim_activity'),
    ])
    const rows = ((dashboard as { programs?: Program[] } | null)?.programs || []).filter((program) => program.is_active)
    setPrograms(rows)
    setProgramId((current) => current || rows[0]?.id || '')
    if (error) setError(error.message)
    else setActivity((claimData as Activity) || { active_qr_campaigns: [], recent_claims: [] })
  }

  useEffect(() => { void load() }, [])

  const fullClaimUrl = useMemo(() => createdQr ? `${window.location.origin}${createdQr.claim_url}` : '', [createdQr])

  async function createQr(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setCreatedQr(null)
    const { data, error } = await supabase.rpc('create_stamp_qr_campaign', {
      p_program_id: programId,
      p_stamps: Number(stamps),
      p_max_claims: Number(maxClaims),
      p_valid_minutes: Number(validMinutes),
    })
    if (error) setError(error.message)
    else { setCreatedQr(data as CreatedQr); setMessage('Secure claim link created.'); await load() }
    setBusy(false)
  }

  async function copyClaimLink() {
    if (!fullClaimUrl) return
    await navigator.clipboard.writeText(fullClaimUrl)
    setMessage('Claim link copied.')
  }

  async function awardManual(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const { error } = await supabase.rpc('staff_adjust_customer_stamps', {
      p_program_id: programId,
      p_customer_user_id: customerId.trim(),
      p_stamps: Number(manualStamps),
      p_note: manualNote,
    })
    if (error) setError(error.message)
    else { setMessage('Stamps awarded successfully.'); setCustomerId(''); await load() }
    setBusy(false)
  }

  return <main className="stamp-ops-page">
    <header><div><span>Loyalty operations</span><h1>QR & staff stamping</h1><p>Create short-lived claim links and issue audited manual stamps.</p></div><nav><Link to="/loyalty/stamps">Campaigns</Link><Link to="/loyalty/rewards">Rewards</Link></nav></header>
    {error && <p className="stamp-ops-error">{error}</p>}{message && <p className="stamp-ops-message">{message}</p>}
    <section className="stamp-ops-grid">
      <form onSubmit={createQr}><span>Customer claim</span><h2>Create secure claim link</h2><label>Stamp programme<select value={programId} onChange={(event) => setProgramId(event.target.value)} required>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label><div className="stamp-ops-row"><label>Stamps<input type="number" min="1" max="20" value={stamps} onChange={(event) => setStamps(event.target.value)} /></label><label>Maximum claims<input type="number" min="1" max="10000" value={maxClaims} onChange={(event) => setMaxClaims(event.target.value)} /></label><label>Valid minutes<input type="number" min="1" max="1440" value={validMinutes} onChange={(event) => setValidMinutes(event.target.value)} /></label></div><button disabled={busy || !programId}>{busy ? 'Creating…' : 'Create claim link'}</button>
        {createdQr && <div className="stamp-ops-link"><strong>Ready until {dateTime.format(new Date(createdQr.expires_at))}</strong><input readOnly value={fullClaimUrl}/><div><button type="button" onClick={() => void copyClaimLink()}>Copy link</button><button type="button" onClick={() => window.print()}>Print</button></div></div>}
      </form>
      <form onSubmit={awardManual}><span>Staff adjustment</span><h2>Award stamps manually</h2><label>Stamp programme<select value={programId} onChange={(event) => setProgramId(event.target.value)} required>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label><label>Customer user ID<input value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder="Customer UUID" required /></label><label>Stamps<input type="number" min="1" max="20" value={manualStamps} onChange={(event) => setManualStamps(event.target.value)} required /></label><label>Audit note<textarea rows={3} value={manualNote} onChange={(event) => setManualNote(event.target.value)} required /></label><button disabled={busy || !programId || !customerId.trim()}>{busy ? 'Awarding…' : 'Award stamps'}</button></form>
    </section>
    <section className="stamp-ops-activity"><div><span>Live campaigns</span><h2>Claim activity</h2></div><div className="stamp-ops-campaigns">{activity.active_qr_campaigns.length ? activity.active_qr_campaigns.map((campaign) => <article key={campaign.id}><strong>{campaign.program_name}</strong><span>{campaign.stamps_awarded} stamp{campaign.stamps_awarded===1?'':'s'}</span><small>{campaign.claim_count}/{campaign.max_claims} claims · expires {dateTime.format(new Date(campaign.expires_at))}</small></article>) : <p>No active claim links.</p>}</div><div className="stamp-ops-claims">{activity.recent_claims.length ? activity.recent_claims.map((claim) => <article key={claim.id}><div><strong>{claim.program_name}</strong><small>{claim.customer_user_id}</small></div><span>+{claim.stamps_awarded}</span><small>{dateTime.format(new Date(claim.claimed_at))}</small></article>) : <p>No QR claims yet.</p>}</div></section>
  </main>
}
