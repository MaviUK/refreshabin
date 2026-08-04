import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

function normaliseOrigin(value: string) {
  return value.trim().replace(/\/$/, '')
}

function allowedOrigins() {
  const allowed = new Set<string>([
    'https://ordered.food',
    'https://www.ordered.food',
  ])

  const siteUrl = normaliseOrigin(Deno.env.get('SITE_URL') ?? '')
  if (siteUrl) allowed.add(siteUrl)

  for (const value of (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '').split(',')) {
    const origin = normaliseOrigin(value)
    if (origin) allowed.add(origin)
  }

  return allowed
}

function corsHeaders(request: Request) {
  const requestOrigin = normaliseOrigin(request.headers.get('Origin') ?? '')
  const allowedOrigin = requestOrigin && allowedOrigins().has(requestOrigin) ? requestOrigin : 'null'

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request)
  if (request.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405)
  if (request.headers.get('Origin') && cors['Access-Control-Allow-Origin'] === 'null') return json(request, { error: 'Origin is not allowed.' }, 403)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = request.headers.get('Authorization')
  if (!stripeKey || !supabaseUrl || !serviceRoleKey || !authHeader) return json(request, { error: 'Payment service is not configured.' }, 500)

  let body: { order_id?: unknown; action?: unknown; preparation_minutes?: unknown; promised_at?: unknown }
  try { body = await request.json() } catch { return json(request, { error: 'Invalid request body.' }, 400) }
  const orderId = typeof body.order_id === 'string' ? body.order_id : ''
  const action = body.action === 'accept' || body.action === 'reject' ? body.action : ''
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !action) return json(request, { error: 'A valid order and action are required.' }, 400)

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data: userData } = await client.auth.getUser(token)
  if (!userData.user) return json(request, { error: 'Authentication required.' }, 401)

  const { data: order, error: orderError } = await client
    .from('orders')
    .select('id,order_number,restaurant_id,order_status,payment_status,stripe_payment_intent_id')
    .eq('id', orderId)
    .single()
  if (orderError || !order) return json(request, { error: 'Order not found.' }, 404)

  const { data: membership } = await client
    .from('restaurant_members')
    .select('restaurant_id')
    .eq('user_id', userData.user.id)
    .eq('restaurant_id', order.restaurant_id)
    .maybeSingle()
  if (!membership) return json(request, { error: 'You cannot manage this order.' }, 403)
  if (order.order_status !== 'placed' || !['authorized', 'paid'].includes(order.payment_status) || !order.stripe_payment_intent_id) {
    return json(request, { error: 'This order is no longer awaiting restaurant acceptance.' }, 409)
  }

  const stripe = new Stripe(stripeKey)
  const now = new Date().toISOString()
  const expectedPaymentStatus = order.payment_status

  try {
    if (action === 'accept') {
      if (order.payment_status === 'authorized') {
        const intent = await stripe.paymentIntents.capture(order.stripe_payment_intent_id, {}, {
          idempotencyKey: `capture-order-${order.id}`,
        })
        if (intent.status !== 'succeeded') return json(request, { error: 'Payment could not be captured.' }, 409)
      }

      const minutes = Number(body.preparation_minutes)
      const promisedAt = typeof body.promised_at === 'string' && !Number.isNaN(Date.parse(body.promised_at))
        ? body.promised_at
        : new Date(Date.now() + (Number.isInteger(minutes) && minutes >= 5 && minutes <= 480 ? minutes : 20) * 60_000).toISOString()
      const { data: updated, error } = await client.from('orders').update({
        order_status: 'accepted', payment_status: 'paid', accepted_at: now,
        paid_at: order.payment_status === 'authorized' ? now : undefined,
        estimated_ready_at: promisedAt,
      }).eq('id', order.id).eq('order_status', 'placed').eq('payment_status', expectedPaymentStatus).select('id').maybeSingle()
      if (error) throw error
      if (!updated) return json(request, { error: 'This order changed on another device.' }, 409)
      return json(request, { success: true, order_status: 'accepted', payment_status: 'paid', estimated_ready_at: promisedAt })
    }

    if (order.payment_status === 'authorized') {
      await stripe.paymentIntents.cancel(order.stripe_payment_intent_id, {
        cancellation_reason: 'requested_by_customer',
      }, { idempotencyKey: `cancel-order-${order.id}` })
    } else {
      await stripe.refunds.create({
        payment_intent: order.stripe_payment_intent_id,
        reverse_transfer: true,
        refund_application_fee: true,
        metadata: { order_id: order.id, reason: 'restaurant_rejected' },
      }, { idempotencyKey: `reject-refund-order-${order.id}` })
    }

    const rejectedPaymentStatus = order.payment_status === 'authorized' ? 'cancelled' : 'refunded'
    const { data: updated, error } = await client.from('orders').update({
      order_status: 'rejected', payment_status: rejectedPaymentStatus, cancelled_at: now,
      manual_payout_status: 'not_applicable',
    }).eq('id', order.id).eq('order_status', 'placed').eq('payment_status', expectedPaymentStatus).select('id').maybeSingle()
    if (error) throw error
    if (!updated) return json(request, { error: 'This order changed on another device.' }, 409)
    return json(request, { success: true, order_status: 'rejected', payment_status: rejectedPaymentStatus })
  } catch (error) {
    console.error('Restaurant payment decision failed', error)
    return json(request, { error: action === 'accept' ? 'Unable to accept and capture this order.' : 'Unable to reject and release/refund this order.' }, 500)
  }
})
