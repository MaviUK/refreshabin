import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 4 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_ALLOWED_ORIGINS = ['https://ordered.food', 'https://www.ordered.food']

function allowedOrigins() {
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
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
    p_function_name: 'admin-cancel-order',
    p_subject_key: subjectKey,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  })
  if (error) throw error
  return data as { allowed: boolean; retry_after_seconds: number }
}

type CancellationContext = {
  id: string
  order_number: number
  restaurant_id: string
  restaurant_name: string
  order_status: string
  payment_status: string
  stripe_payment_intent_id: string | null
  total_pence: number
  currency: string
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
    console.error('Order cancellation service environment is incomplete')
    return reply(request, { error: 'Order cancellation service is not configured.' }, 500)
  }
  if (!authorization) return reply(request, { error: 'Authentication required.' }, 401)

  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return reply(request, { error: 'Request body is too large.' }, 413)
  }

  let body: { order_id?: string; reason?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return reply(request, { error: 'Invalid request body.' }, 400)
  }

  const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!UUID_PATTERN.test(orderId) || reason.length < 3 || reason.length > 500) {
    return reply(request, { error: 'A valid order and cancellation reason between 3 and 500 characters are required.' }, 400)
  }

  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return reply(request, { error: 'Your session has expired. Please sign in again.' }, 401)

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const adminLimit = await consumeLimit(service, `admin:${userData.user.id}`, 60 * 60, 30)
    if (!adminLimit.allowed) {
      return reply(request, { error: 'Too many cancellation attempts. Please try again later.' }, 429, {
        'Retry-After': String(adminLimit.retry_after_seconds),
      })
    }
    const orderLimit = await consumeLimit(service, `order:${orderId}`, 10 * 60, 5)
    if (!orderLimit.allowed) {
      return reply(request, { error: 'Too many cancellation attempts for this order. Please try again later.' }, 429, {
        'Retry-After': String(orderLimit.retry_after_seconds),
      })
    }
  } catch (error) {
    console.error('Cancellation rate limit check failed', error)
    return reply(request, { error: 'Cancellation controls could not be verified. Please try again.' }, 503)
  }

  const { data: contextData, error: contextError } = await service.rpc('get_platform_order_cancellation_context', {
    p_order_id: orderId,
    p_actor_user_id: userData.user.id,
  })
  if (contextError) {
    const status = contextError.code === '42501' ? 403 : contextError.code === 'P0002' ? 404 : 400
    return reply(request, { error: contextError.message }, status)
  }

  const context = contextData as CancellationContext
  const stripe = new Stripe(stripeKey)
  let finalPaymentStatus = context.payment_status
  let stripeRefundId: string | null = null
  let stripeRefundStatus: string | null = null
  let refundRequestId: string | null = null

  try {
    if (context.stripe_payment_intent_id) {
      const paymentIntent = await stripe.paymentIntents.retrieve(context.stripe_payment_intent_id, {
        expand: ['latest_charge'],
      })

      if (paymentIntent.status === 'succeeded') {
        const latestCharge = paymentIntent.latest_charge
        const charge = latestCharge && typeof latestCharge !== 'string' ? latestCharge : null
        const refundableAmount = charge ? Math.max(charge.amount - charge.amount_refunded, 0) : Math.max(paymentIntent.amount_received, 0)

        if (refundableAmount > 0) {
          const { data: refundRow, error: refundInsertError } = await service
            .from('platform_refunds')
            .insert({
              order_id: orderId,
              amount_pence: refundableAmount,
              reason,
              requested_by: userData.user.id,
            })
            .select('id')
            .single()
          if (refundInsertError) throw refundInsertError
          refundRequestId = refundRow.id as string

          const refund = await stripe.refunds.create({
            payment_intent: context.stripe_payment_intent_id,
            amount: refundableAmount,
            metadata: {
              order_id: orderId,
              cancellation: 'platform_admin',
              refund_request_id: refundRequestId,
            },
          }, { idempotencyKey: `ordered-cancel-refund-${orderId}` })

          stripeRefundId = refund.id
          stripeRefundStatus = refund.status
          const accepted = refund.status === 'succeeded' || refund.status === 'pending'
          const { error: completeError } = await service.rpc('complete_platform_refund', {
            p_refund_request_id: refundRequestId,
            p_stripe_refund_id: refund.id,
            p_succeeded: accepted,
            p_failure_message: refund.failure_reason ?? null,
          })
          if (completeError) throw completeError
          if (!accepted) throw new Error(refund.failure_reason || 'Stripe did not accept the refund.')
        }
        finalPaymentStatus = 'refunded'
      } else if (paymentIntent.status !== 'canceled') {
        await stripe.paymentIntents.cancel(context.stripe_payment_intent_id, {
          cancellation_reason: 'requested_by_customer',
        })
        finalPaymentStatus = 'cancelled'
      } else {
        finalPaymentStatus = 'cancelled'
      }
    } else if (context.payment_status === 'paid' || context.payment_status === 'partially_refunded') {
      finalPaymentStatus = 'refunded'
    } else if (context.payment_status === 'pending' || context.payment_status === 'requires_action' || context.payment_status === 'authorized') {
      finalPaymentStatus = 'cancelled'
    }
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : 'Stripe could not reverse the payment.'
    if (refundRequestId && !stripeRefundId) {
      await service.rpc('complete_platform_refund', {
        p_refund_request_id: refundRequestId,
        p_stripe_refund_id: null,
        p_succeeded: false,
        p_failure_message: internalMessage.slice(0, 500),
      })
    }
    console.error('Order payment reversal failed', orderId, error)
    return reply(request, { error: 'The payment could not be reversed, so the order was not cancelled. Check the payment status before trying again.' }, 502)
  }

  const { data: result, error: finalizeError } = await service.rpc('finalize_platform_order_cancellation', {
    p_order_id: orderId,
    p_actor_user_id: userData.user.id,
    p_reason: reason,
    p_payment_status: finalPaymentStatus,
    p_stripe_refund_id: stripeRefundId,
    p_stripe_refund_status: stripeRefundStatus,
  })
  if (finalizeError) {
    console.error('Payment was reversed but order cancellation finalization failed', orderId, finalizeError)
    return reply(request, {
      error: 'The payment reversal was accepted, but the order record could not be finalised. Do not retry payment reversal; contact platform support.',
      payment_reversed: true,
      stripe_refund_id: stripeRefundId,
    }, 500)
  }

  return reply(request, {
    cancellation: result,
    payment_reversed: finalPaymentStatus === 'refunded' || finalPaymentStatus === 'cancelled',
    stripe_refund_id: stripeRefundId,
    stripe_refund_status: stripeRefundStatus,
  })
})