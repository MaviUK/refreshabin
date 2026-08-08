import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 4 * 1024
const normalize = (value: string) => value.trim().replace(/\/$/, '')

function cors(request: Request) {
  const origin = normalize(request.headers.get('origin') ?? '')
  const allowed = new Set([
    'https://ordered.food',
    'https://www.ordered.food',
    normalize(Deno.env.get('SITE_URL') ?? ''),
    ...(Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '').split(',').map(normalize),
  ].filter(Boolean))
  return {
    'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

function reply(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(request), ...extra, 'Content-Type': 'application/json' } })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character))
}

async function sendGiftCardEmail(apiKey: string, from: string, recipient: string, restaurantName: string, code: string, amount: string, recipientName: string | null, message: string | null) {
  const safeRestaurant = escapeHtml(restaurantName)
  const safeName = escapeHtml(recipientName || 'You')
  const safeMessage = message ? `<p style="font-size:16px;line-height:1.6;color:#4b453e">${escapeHtml(message)}</p>` : ''
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `Your ${restaurantName} gift card`,
      html: `<div style="font-family:Arial,sans-serif;background:#f6f3ed;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px"><p style="font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#756d63">ordered.food gift card</p><h1 style="font-size:30px;margin:8px 0 16px">${safeName}, you have a ${amount} gift card</h1><p style="font-size:17px;color:#4b453e">Use it when ordering from <strong>${safeRestaurant}</strong>.</p>${safeMessage}<div style="margin:28px 0;padding:22px;border-radius:14px;background:#171615;color:#fff;text-align:center"><span style="display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Gift card code</span><strong style="display:block;font-size:25px;margin-top:10px;letter-spacing:.08em">${escapeHtml(code)}</strong></div><p style="color:#746c63">Enter this code during checkout. Partial balances remain available for future orders.</p></div></div>`,
    }),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}`)
}

Deno.serve(async (request) => {
  const headers = cors(request)
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return reply(request, { error: 'Method not allowed.' }, 405)
  if (request.headers.get('origin') && headers['Access-Control-Allow-Origin'] === 'null') return reply(request, { error: 'Origin is not allowed.' }, 403)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return reply(request, { error: 'Request body is too large.' }, 413)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!stripeKey || !url || !serviceKey) return reply(request, { error: 'Gift card finalisation is not configured.' }, 500)

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return reply(request, { error: 'Request body is too large.' }, 413)
  let body: { session_id?: unknown }
  try { body = JSON.parse(rawBody) } catch { return reply(request, { error: 'Invalid request body.' }, 400) }
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId.startsWith('cs_')) return reply(request, { error: 'A valid checkout session is required.' }, 400)

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const rateKey = `${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}:${sessionId}`
  const { data: rate } = await db.rpc('consume_edge_function_rate_limit', { p_function_name: 'finalize-gift-card-purchase', p_subject_key: rateKey, p_window_seconds: 900, p_max_requests: 10 })
  if (rate && !(rate as { allowed: boolean }).allowed) return reply(request, { error: 'Too many verification attempts. Please try again shortly.' }, 429, { 'Retry-After': String((rate as { retry_after_seconds?: number }).retry_after_seconds ?? 900) })

  try {
    const stripe = new Stripe(stripeKey)
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid' || session.metadata?.purchase_type !== 'gift_card') return reply(request, { error: 'Gift card payment has not completed.' }, 409)
    const purchaseId = session.metadata.gift_card_purchase_id
    if (!purchaseId) return reply(request, { error: 'Gift card purchase metadata is missing.' }, 409)
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || ''

    const { data: issued, error: issueError } = await db.rpc('issue_paid_gift_card_purchase', { p_purchase_id: purchaseId, p_session_id: session.id, p_payment_intent_id: paymentIntentId })
    if (issueError) throw issueError

    const { data: purchase, error: purchaseError } = await db.from('gift_card_purchases').select('id,recipient_email,recipient_name,message,value_pence,delivery_at,email_sent_at,restaurant_gift_cards(code),restaurants(name,slug)').eq('id', purchaseId).single()
    if (purchaseError || !purchase) throw purchaseError || new Error('Purchase could not be loaded')

    const restaurantValue = Array.isArray(purchase.restaurants) ? purchase.restaurants[0] : purchase.restaurants
    const cardValue = Array.isArray(purchase.restaurant_gift_cards) ? purchase.restaurant_gift_cards[0] : purchase.restaurant_gift_cards
    const dueNow = new Date(purchase.delivery_at).getTime() <= Date.now()
    let emailSent = Boolean(purchase.email_sent_at)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const emailFrom = Deno.env.get('RESEND_FROM_EMAIL') || 'ordered.food <orders@ordered.food>'
    if (dueNow && !emailSent && resendKey && restaurantValue && cardValue) {
      await sendGiftCardEmail(resendKey, emailFrom, purchase.recipient_email, restaurantValue.name, cardValue.code, `£${(purchase.value_pence / 100).toFixed(2)}`, purchase.recipient_name, purchase.message)
      await db.from('gift_card_purchases').update({ email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', purchase.id)
      emailSent = true
    }

    return reply(request, {
      status: 'issued',
      purchase_id: purchase.id,
      restaurant_name: restaurantValue?.name,
      restaurant_slug: restaurantValue?.slug,
      delivery_at: purchase.delivery_at,
      email_sent: emailSent,
      scheduled: !dueNow,
      already_issued: Boolean((issued as { already_issued?: boolean } | null)?.already_issued),
    })
  } catch (error) {
    console.error('Gift card finalisation failed', error)
    return reply(request, { error: 'Gift card payment could not be verified.' }, 502)
  }
})
