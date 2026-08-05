import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 8 * 1024
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
  const siteUrl = normalize(Deno.env.get('SITE_URL') ?? '')
  if (!stripeKey || !url || !serviceKey || !siteUrl) return reply(request, { error: 'Gift card checkout is not configured.' }, 500)

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return reply(request, { error: 'Request body is too large.' }, 413)

  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) } catch { return reply(request, { error: 'Invalid request body.' }, 400) }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const purchaserEmail = typeof body.purchaser_email === 'string' ? body.purchaser_email.trim().toLowerCase() : ''
  const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim().toLowerCase() : ''
  const recipientName = typeof body.recipient_name === 'string' ? body.recipient_name.trim().slice(0, 120) : ''
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : ''
  const valuePence = Number(body.value_pence)
  const deliveryAt = typeof body.delivery_at === 'string' ? new Date(body.delivery_at) : new Date()

  if (!slug || !/^\S+@\S+\.\S+$/.test(purchaserEmail) || !/^\S+@\S+\.\S+$/.test(recipientEmail)) return reply(request, { error: 'Valid purchaser and recipient emails are required.' }, 400)
  if (!Number.isInteger(valuePence) || valuePence < 500 || valuePence > 100000) return reply(request, { error: 'Gift card value must be between £5 and £1,000.' }, 400)
  if (Number.isNaN(deliveryAt.getTime()) || deliveryAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) return reply(request, { error: 'Choose a valid delivery date within the next year.' }, 400)

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const rateKey = `${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}:${purchaserEmail}`
  const { data: rate } = await db.rpc('consume_edge_function_rate_limit', { p_function_name: 'create-gift-card-checkout', p_subject_key: rateKey, p_window_seconds: 3600, p_max_requests: 10 })
  if (rate && !(rate as { allowed: boolean }).allowed) return reply(request, { error: 'Too many gift card checkout attempts. Please try again later.' }, 429, { 'Retry-After': String((rate as { retry_after_seconds?: number }).retry_after_seconds ?? 3600) })

  const { data: restaurant, error: restaurantError } = await db.from('restaurants').select('id,name,slug,status').eq('slug', slug).eq('status', 'active').maybeSingle()
  if (restaurantError || !restaurant) return reply(request, { error: 'Restaurant is not available for gift cards.' }, 404)

  const { data: purchase, error: purchaseError } = await db.from('gift_card_purchases').insert({
    restaurant_id: restaurant.id,
    purchaser_email: purchaserEmail,
    recipient_email: recipientEmail,
    recipient_name: recipientName || null,
    message: message || null,
    value_pence: valuePence,
    delivery_at: deliveryAt.toISOString(),
  }).select('id').single()
  if (purchaseError || !purchase) return reply(request, { error: 'Gift card purchase could not be created.' }, 500)

  try {
    const stripe = new Stripe(stripeKey)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: purchaserEmail,
      line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: valuePence, product_data: { name: `${restaurant.name} gift card`, description: recipientName ? `Gift for ${recipientName}` : 'Restaurant gift card' } } }],
      success_url: `${siteUrl}/r/${restaurant.slug}/gift-card/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/r/${restaurant.slug}/gift-card?payment=cancelled`,
      client_reference_id: purchase.id,
      metadata: { purchase_type: 'gift_card', gift_card_purchase_id: purchase.id, restaurant_id: restaurant.id },
      payment_intent_data: { metadata: { purchase_type: 'gift_card', gift_card_purchase_id: purchase.id, restaurant_id: restaurant.id } },
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }, { idempotencyKey: `gift-card-purchase-${purchase.id}` })

    await db.from('gift_card_purchases').update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', purchase.id)
    return reply(request, { checkout_url: session.url, session_id: session.id })
  } catch (error) {
    console.error('Gift card checkout failed', error)
    await db.from('gift_card_purchases').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', purchase.id)
    return reply(request, { error: 'Secure payment could not be opened.' }, 502)
  }
})
