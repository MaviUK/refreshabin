import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

function normaliseOrigin(value: string) {
  return value.trim().replace(/\/$/, '')
}

function allowedOrigins() {
  const allowed = new Set<string>(['https://ordered.food', 'https://www.ordered.food'])
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
  return {
    'Access-Control-Allow-Origin': requestOrigin && allowedOrigins().has(requestOrigin) ? requestOrigin : 'null',
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

function paymentErrorDetails(error: unknown) {
  if (error instanceof Error) return { message: error.message, type: error.name }
  if (typeof error === 'string') return { message: error }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const raw = value.raw && typeof value.raw === 'object' ? value.raw as Record<string, unknown> : undefined
    const message = typeof value.message === 'string'
      ? value.message
      : typeof raw?.message === 'string'
        ? raw.message
        : 'Payment provider returned an unrecognised error.'
    return {
      message,
      type: typeof value.type === 'string' ? value.type : typeof raw?.type === 'string' ? raw.type : undefined,
      code: typeof value.code === 'string' ? value.code : typeof raw?.code === 'string' ? raw.code : undefined,
      decline_code: typeof value.decline_code === 'string' ? value.decline_code : typeof raw?.decline_code === 'string' ? raw.decline_code : undefined,
      request_id: typeof value.requestId === 'string' ? value.requestId : undefined,
    }
  }
  return { message: 'Payment provider returned an unknown error.' }
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
    .select('id,order_number,restaurant_id,order_status,payment_status,restaurant_payout_mode,stripe_payment_intent_id')
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
  if (order.order_status !== 'placed' || !order.stripe_payment_intent_id) {
    return json(request, { error: 'This order is no longer awaiting restaurant acceptance.' }, 409)
  }

  const stripe = new Stripe(stripeKey)
  const now = new Date().toISOString()

  try {
    const intent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)

    if (action === 'accept') {
      if (intent.status === 'requires_capture') {
        const captured = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `capture-v2-${intent.id}` })
        if (captured.status !== 'succeeded') return json(request, { error: 'Payment could not be captured.' }, 409)
      } else if (intent.status !== 'succeeded') {
        return json(request, { error: `Payment cannot be accepted while Stripe status is ${intent.status}.` }, 409)
      }

      const minutes = Number(body.preparation_minutes)
      const promisedAt = typeof body.promised_at === 'string' && !Number.isNaN(Date.parse(body.promised_at))
        ? body.promised_at
        : new Date(Date.now() + (Number.isInteger(minutes) && minutes >= 5 && minutes <= 480 ? minutes : 20) * 60_000).toISOString()
      const { data: updated, error } = await client.from('orders').update({
        order_status: 'accepted', payment_status: 'paid', accepted_at: now, paid_at: now, estimated_ready_at: promisedAt,
      }).eq('id', order.id).eq('order_status', 'placed').select('id').maybeSingle()
      if (error) throw error
      if (!updated) return json(request, { error: 'This order changed on another device.' }, 409)
      return json(request, { success: true, order_status: 'accepted', payment_status: 'paid', estimated_ready_at: promisedAt })
    }

    let rejectedPaymentStatus: 'cancelled' | 'refunded'
    if (intent.status === 'requires_capture' || intent.status === 'requires_payment_method' || intent.status === 'requires_confirmation' || intent.status === 'requires_action' || intent.status === 'processing') {
      await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: 'requested_by_customer' }, { idempotencyKey: `reject-cancel-v2-${intent.id}` })
      rejectedPaymentStatus = 'cancelled'
    } else if (intent.status === 'succeeded') {
      const refund: Stripe.RefundCreateParams = {
        payment_intent: intent.id,
        metadata: { order_id: order.id, reason: 'restaurant_rejected' },
      }
      if (order.restaurant_payout_mode === 'stripe_connect') {
        refund.reverse_transfer = true
        refund.refund_application_fee = true
      }
      await stripe.refunds.create(refund, { idempotencyKey: `reject-refund-v2-${order.restaurant_payout_mode}-${intent.id}` })
      rejectedPaymentStatus = 'refunded'
    } else if (intent.status === 'canceled') {
      rejectedPaymentStatus = 'cancelled'
    } else {
      return json(request, { error: `Payment cannot be rejected while Stripe status is ${intent.status}.` }, 409)
    }

    const { data: updated, error } = await client.from('orders').update({
      order_status: 'rejected', payment_status: rejectedPaymentStatus, cancelled_at: now, manual_payout_status: 'not_applicable',
    }).eq('id', order.id).eq('order_status', 'placed').select('id').maybeSingle()
    if (error) throw error
    if (!updated) return json(request, { error: 'This order changed on another device.' }, 409)
    return json(request, { success: true, order_status: 'rejected', payment_status: rejectedPaymentStatus })
  } catch (error) {
    const details = paymentErrorDetails(error)
    console.error('Restaurant payment decision failed', JSON.stringify(details))
    return json(request, { error: details.message, details }, 500)
  }
})
