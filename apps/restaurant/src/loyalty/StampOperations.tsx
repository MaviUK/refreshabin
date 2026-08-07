import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import { supabase } from '../lib/supabase'
import './StampOperations.css'

type Program = { id: string; name: string; description?: string | null; reward_name?: string | null; is_active: boolean }
type RestaurantBrand = { id: string; name: string; slug: string; logo_url: string | null; cover_url: string | null }
type ProgramDashboard = { programs?: Program[]; restaurant?: RestaurantBrand | null }
type QrCampaign = { id: string; program_id: string; program_name: string; stamps_awarded: number; claim_count: number; max_claims: number; expires_at: string; is_active: boolean }
type Claim = { id: string; program_name: string; customer_user_id: string; stamps_awarded: number; claimed_at: string }
type Activity = { active_qr_campaigns: QrCampaign[]; recent_claims: Claim[] }
type CreatedQr = { campaign_id: string; token: string; expires_at: string; claim_url: string }
type PosterSize = 'A4' | 'A5'

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stamp-campaign'
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character))
}

export default function StampOperations() {
  const [programs, setPrograms] = useState<Program[]>([])
  const [restaurant, setRestaurant] = useState<RestaurantBrand | null>(null)
  const [activity, setActivity] = useState<Activity>({ active_qr_campaigns: [], recent_claims: [] })
  const [programId, setProgramId] = useState('')
  const [stamps, setStamps] = useState('1')
  const [maxClaims, setMaxClaims] = useState('1')
  const [validMinutes, setValidMinutes] = useState('10')
  const [createdQr, setCreatedQr] = useState<CreatedQr | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [posterSize, setPosterSize] = useState<PosterSize>('A4')
  const [customerId, setCustomerId] = useState('')
  const [manualStamps, setManualStamps] = useState('1')
  const [manualNote, setManualNote] = useState('In-store purchase')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    const [{ data: dashboard, error: dashboardError }, { data: claimData, error: claimError }] = await Promise.all([
      supabase.rpc('get_restaurant_stamp_programs'),
      supabase.rpc('get_restaurant_stamp_claim_activity'),
    ])
    const stampDashboard = (dashboard as ProgramDashboard | null) || {}
    const rows = (stampDashboard.programs || []).filter((program) => program.is_active)
    setPrograms(rows)
    setRestaurant(stampDashboard.restaurant || null)
    setProgramId((current) => current || rows[0]?.id || '')
    if (dashboardError || claimError) setError(dashboardError?.message || claimError?.message || 'Unable to load stamp operations')
    else setActivity((claimData as Activity) || { active_qr_campaigns: [], recent_claims: [] })
  }

  useEffect(() => { void load() }, [])

  const selectedProgram = programs.find((program) => program.id === programId)
  const fullClaimUrl = useMemo(() => createdQr ? `${window.location.origin}${createdQr.claim_url}` : '', [createdQr])
  const campaignTitle = selectedProgram?.name || 'Stamp reward'
  const brandName = restaurant?.name || 'ordered.food'

  async function createQr(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    setCreatedQr(null)
    setQrDataUrl('')

    const { data, error: createError } = await supabase.rpc('create_stamp_qr_campaign', {
      p_program_id: programId,
      p_stamps: Number(stamps),
      p_max_claims: Number(maxClaims),
      p_valid_minutes: Number(validMinutes),
    })

    if (createError) setError(createError.message)
    else {
      try {
        const result = data as CreatedQr
        const claimUrl = `${window.location.origin}${result.claim_url}`
        const renderedQr = await QRCode.toDataURL(claimUrl, { width: 900, margin: 3, errorCorrectionLevel: 'M' })
        setCreatedQr(result)
        setQrDataUrl(renderedQr)
        setMessage('Secure QR campaign and branded assets are ready.')
        await load()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to render QR code')
      }
    }
    setBusy(false)
  }

  async function copyClaimLink() {
    if (!fullClaimUrl) return
    await navigator.clipboard.writeText(fullClaimUrl)
    setMessage('Claim link copied.')
  }

  function downloadQr() {
    if (!qrDataUrl) return
    const anchor = document.createElement('a')
    anchor.href = qrDataUrl
    anchor.download = `${safeFilename(`${brandName}-${campaignTitle}`)}-qr.png`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setMessage('QR image downloaded.')
  }

  async function downloadPosterPdf() {
    if (!createdQr || !qrDataUrl) return
    setBusy(true)
    setError('')
    try {
      const format = posterSize.toLowerCase() as 'a4' | 'a5'
      const document = new jsPDF({ orientation: 'portrait', unit: 'mm', format })
      const width = document.internal.pageSize.getWidth()
      const height = document.internal.pageSize.getHeight()
      const margin = posterSize === 'A4' ? 20 : 14
      const qrSize = Math.min(width - margin * 2, posterSize === 'A4' ? 125 : 88)
      const centre = width / 2

      document.setFont('helvetica', 'bold')
      document.setFontSize(posterSize === 'A4' ? 28 : 21)
      document.text(brandName, centre, margin + 8, { align: 'center', maxWidth: width - margin * 2 })
      document.setFontSize(posterSize === 'A4' ? 18 : 14)
      document.text(campaignTitle, centre, margin + 22, { align: 'center', maxWidth: width - margin * 2 })
      document.setFont('helvetica', 'normal')
      document.setFontSize(posterSize === 'A4' ? 13 : 10)
      document.text(`Scan to collect ${stamps} stamp${Number(stamps) === 1 ? '' : 's'}`, centre, margin + 32, { align: 'center' })

      const qrY = margin + 41
      document.addImage(qrDataUrl, 'PNG', centre - qrSize / 2, qrY, qrSize, qrSize)
      document.setFontSize(posterSize === 'A4' ? 11 : 8.5)
      const footerY = Math.min(height - margin - 20, qrY + qrSize + 14)
      document.text(`Reward: ${selectedProgram?.reward_name || campaignTitle}`, centre, footerY, { align: 'center', maxWidth: width - margin * 2 })
      document.text(`Valid until ${dateTime.format(new Date(createdQr.expires_at))}`, centre, footerY + 7, { align: 'center' })
      document.setFontSize(posterSize === 'A4' ? 9 : 7)
      document.text('Powered by ordered.food', centre, height - margin, { align: 'center' })
      document.save(`${safeFilename(`${brandName}-${campaignTitle}`)}-${posterSize.toLowerCase()}.pdf`)
      setMessage(`${posterSize} poster PDF downloaded.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create poster PDF')
    }
    setBusy(false)
  }

  function printPoster() {
    if (!createdQr || !qrDataUrl) return
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000')
    if (!printWindow) {
      setError('Pop-ups are blocked. Allow pop-ups to print the poster.')
      return
    }
    const logo = restaurant?.logo_url ? `<img class="logo" src="${escapeHtml(restaurant.logo_url)}" alt="" />` : ''
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(brandName)} ${escapeHtml(campaignTitle)}</title><style>@page{size:${posterSize} portrait;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#171614}.poster{width:${posterSize === 'A4' ? '210mm' : '148mm'};height:${posterSize === 'A4' ? '297mm' : '210mm'};padding:${posterSize === 'A4' ? '20mm' : '13mm'};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.logo{max-width:42mm;max-height:25mm;object-fit:contain;margin-bottom:8mm}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-weight:700;font-size:9pt;color:#756d63}.brand{font-size:${posterSize === 'A4' ? '31pt' : '23pt'};margin:3mm 0 2mm}.campaign{font-size:${posterSize === 'A4' ? '20pt' : '15pt'};margin:0 0 4mm}.copy{font-size:${posterSize === 'A4' ? '15pt' : '11pt'};margin:0 0 7mm}.qr{width:${posterSize === 'A4' ? '120mm' : '82mm'};height:${posterSize === 'A4' ? '120mm' : '82mm'};object-fit:contain}.reward{font-size:${posterSize === 'A4' ? '13pt' : '10pt'};margin:7mm 0 2mm}.expiry{font-size:${posterSize === 'A4' ? '10pt' : '8pt'};color:#625b52}.powered{margin-top:7mm;font-size:8pt;color:#8a8278}</style></head><body><main class="poster">${logo}<div class="eyebrow">Digital stamp card</div><h1 class="brand">${escapeHtml(brandName)}</h1><h2 class="campaign">${escapeHtml(campaignTitle)}</h2><p class="copy">Scan to collect ${escapeHtml(stamps)} stamp${Number(stamps) === 1 ? '' : 's'}</p><img class="qr" src="${qrDataUrl}" alt="QR code"/><p class="reward">Reward: ${escapeHtml(selectedProgram?.reward_name || campaignTitle)}</p><p class="expiry">Valid until ${escapeHtml(dateTime.format(new Date(createdQr.expires_at)))}</p><p class="powered">Powered by ordered.food</p></main><script>window.addEventListener('load',()=>{window.print();window.close()})<\/script></body></html>`)
    printWindow.document.close()
  }

  async function awardManual(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const { error: awardError } = await supabase.rpc('staff_adjust_customer_stamps', {
      p_program_id: programId,
      p_customer_user_id: customerId.trim(),
      p_stamps: Number(manualStamps),
      p_note: manualNote,
    })
    if (awardError) setError(awardError.message)
    else { setMessage('Stamps awarded successfully.'); setCustomerId(''); await load() }
    setBusy(false)
  }

  return <main className="stamp-ops-page">
    <header><div><span>Loyalty operations</span><h1>QR & staff stamping</h1><p>Create short-lived QR campaigns, branded downloadable assets and audited staff adjustments.</p></div><nav><Link to="/loyalty/stamps">Campaigns</Link><Link to="/loyalty/stamps/analytics">Analytics</Link></nav></header>
    {error && <p className="stamp-ops-error">{error}</p>}{message && <p className="stamp-ops-message">{message}</p>}
    <section className="stamp-ops-grid">
      <form onSubmit={createQr}><span>Customer claim</span><h2>Create secure QR campaign</h2><label>Stamp programme<select value={programId} onChange={(event) => setProgramId(event.target.value)} required>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label><div className="stamp-ops-row"><label>Stamps<input type="number" min="1" max="20" value={stamps} onChange={(event) => setStamps(event.target.value)} /></label><label>Maximum claims<input type="number" min="1" max="10000" value={maxClaims} onChange={(event) => setMaxClaims(event.target.value)} /></label><label>Valid minutes<input type="number" min="1" max="1440" value={validMinutes} onChange={(event) => setValidMinutes(event.target.value)} /></label></div><button disabled={busy || !programId}>{busy ? 'Creating…' : 'Create QR campaign'}</button>
        {createdQr && qrDataUrl && <div className="stamp-ops-link"><strong>Ready until {dateTime.format(new Date(createdQr.expires_at))}</strong><div className="stamp-qr-preview">{restaurant?.logo_url && <img className="stamp-brand-logo" src={restaurant.logo_url} alt={`${brandName} logo`} />}<img className="stamp-qr-image" src={qrDataUrl} alt={`QR code for ${campaignTitle}`} /><div><small className="stamp-brand-name">{brandName}</small><h3>{campaignTitle}</h3><p>Scan to collect {stamps} stamp{Number(stamps) === 1 ? '' : 's'}.</p>{selectedProgram?.reward_name && <p>Reward: {selectedProgram.reward_name}</p>}<small>{fullClaimUrl}</small></div></div><input readOnly value={fullClaimUrl}/><div className="stamp-poster-controls"><label>Poster size<select value={posterSize} onChange={(event) => setPosterSize(event.target.value as PosterSize)}><option value="A4">A4 counter poster</option><option value="A5">A5 counter poster</option></select></label><button type="button" onClick={() => void copyClaimLink()}>Copy link</button><button type="button" onClick={downloadQr}>Download PNG</button><button type="button" onClick={() => void downloadPosterPdf()} disabled={busy}>Download {posterSize} PDF</button><button type="button" onClick={printPoster}>Print {posterSize}</button></div></div>}
      </form>
      <form onSubmit={awardManual}><span>Staff adjustment</span><h2>Award stamps manually</h2><label>Stamp programme<select value={programId} onChange={(event) => setProgramId(event.target.value)} required>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label><label>Customer user ID<input value={customerId} onChange={(event) => setCustomerId(event.target.value)} placeholder="Customer UUID" required /></label><label>Stamps<input type="number" min="1" max="20" value={manualStamps} onChange={(event) => setManualStamps(event.target.value)} required /></label><label>Audit note<textarea rows={3} value={manualNote} onChange={(event) => setManualNote(event.target.value)} required /></label><button disabled={busy || !programId || !customerId.trim()}>{busy ? 'Awarding…' : 'Award stamps'}</button></form>
    </section>
    <section className="stamp-ops-activity"><div><span>Live campaigns</span><h2>Claim activity</h2></div><div className="stamp-ops-campaigns">{activity.active_qr_campaigns.length ? activity.active_qr_campaigns.map((campaign) => <article key={campaign.id}><strong>{campaign.program_name}</strong><span>{campaign.stamps_awarded} stamp{campaign.stamps_awarded===1?'':'s'}</span><small>{campaign.claim_count}/{campaign.max_claims} claims · expires {dateTime.format(new Date(campaign.expires_at))}</small></article>) : <p>No active claim links.</p>}</div><div className="stamp-ops-claims">{activity.recent_claims.length ? activity.recent_claims.map((claim) => <article key={claim.id}><div><strong>{claim.program_name}</strong><small>{claim.customer_user_id}</small></div><span>+{claim.stamps_awarded}</span><small>{dateTime.format(new Date(claim.claimed_at))}</small></article>) : <p>No QR claims yet.</p>}</div></section>
  </main>
}
