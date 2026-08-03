import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 4 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function allowedOrigins() {
  return new Set([
    Deno.env.get('PLATFORM_ADMIN_URL'),
    ...(Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '').split(','),
  ].map((value) => value?.trim().replace(/\/$/, '')).filter(Boolean) as string[])
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin')?.replace(/\/$/, '')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  }
  if (origin && allowedOrigins().has(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function reply(request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), ...extraHeaders, 'Content-Type': 'application/json' },
  })
}

async function consumeLimit(
  service: ReturnType<typeof createClient>,
  subjectKey: string,
  windowSeconds: number,
  maxRequests: number,
) {
  const { data, error } = await service.rpc('consume_edge_function_rate_limit', {
    p_function_name: 'admin-refund-payment',
    p_subject_key: subjectKey,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  })
  if (error) throw error
  return data as { allowed: boolean; retry_after_seconds: number }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin')?.replace(/\/$/, '')
  if (origin && !allowedOrigins().has(origin)) return reply(request, { error: 'Origin not allowed.' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return reply(request, { error: 'Method not allowed.' }, 405)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return reply(request, { error: 'Request body is too large.' }, 413)

  const url = Deno.env.get('SUPABASE_URL')
  const publishable = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const authorization = request.headers.get('Authorization')
  if (!url || !publishable || !serviceKey || !stripeKey) {
    console.error('Refund service environment is incomplete')
    return reply(request, { error: 'Refund service is not configured.' }, 500)
  }
  if (!authorization) return reply(request, { error: 'Authentication required.' }, 401)

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return reply(request, { error: 'Request body is too large.' }, 413)
  }

  let body: { order_id?: string; amount_pence?: number; reason?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return reply(request, { error: 'Invalid request body.' }, 400)
  }

  const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : ''
  const amountPence = Number(body.amount_pence)
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!UUID_PATTERN.test(orderId) || !Number.isInteger(amountPence) || amountPence <= 0 || reason.length < 3 || reason.length > 500) {
    return reply(request, { error: 'A valid order, positive amount and reason between 3 and 500 characters are required.' }, 400)
  }

  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return reply(request, { error: 'Your session has expired. Please sign in again.' }, 401)

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const adminLimit = await consumeLimit(service, `admin:${userData.user.id}`, 60 * 60, 20)
    if (!adminLimit.allowed) {
      return reply(request, { error: 'Too many refund attempts. Please try again later.' }, 429, {
        'Retry-After': String(adminLimit.retry_after_seconds),
      })
    }
    const orderLimit = await consumeLimit(service, `order:${orderId}`, 10 * 60, 5)
    if (!orderLimit.allowed) {
      return reply(request, { error: 'Too many refund attempts for this order. Please try again later.' }, 429, {
        'Retry-After': String(orderLimit.retry_after_seconds),
      })
    }
  } catch (error) {
    console.error('Refund rate limit check failed', error)
    return reply(request, { error: 'Refund controls could not be verified. Please try again.' }, 503)
  }

  const { data: reservation, error: reserveError } = await userClient.rpc('reserve_platform_refund', {
    p_order_id: orderId,
    p_amount_pence: amountPence,
    p_reason: reason,
  })
  if (reserveError) {
    const status = reserveError.code === '42501' ? 403 : 400
    return reply(request, { error: reserveError.message }, status)
  }

  const reserved = reservation as { refund_request_id: string; payment_intent_id: string }
  try {
    const stripe = new Stripe(stripeKey)
    const refund = await stripe.refunds.create({
      payment_intent: reserved.payment_intent_id,
      amount: amountPence,
      metadata: { order_id: orderId, refund_request_id: reserved.refund_request_id },
    }, { idempotencyKey: `ordered-refund-${reserved.refund_request_id}` })

    const { error } = await service.rpc('complete_platform_refund', {
      p_refund_request_id: reserved.refund_request_id,
      p_stripe_refund_id: refund.id,
      p_succeeded: refund.status === 'succeeded' || refund.status === 'pending',
      p_failure_message: refund.failure_reason ?? null,
    })
    if (error) throw error
    return reply(request, { refund_id: refund.id, status: refund.status })
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : 'Stripe rejected the refund.'
    await service.rpc('complete_platform_refund', {
      p_refund_request_id: reserved.refund_request_id,
      p_stripe_refund_id: null,
      p_succeeded: false,
      p_failure_message: internalMessage.slice(0, 500),
    })
    console.error('Refund failed', reserved.refund_request_id, error)
    return reply(request, { error: 'The refund could not be completed. Check the payment status before trying again.' }, 502)
  }
})
