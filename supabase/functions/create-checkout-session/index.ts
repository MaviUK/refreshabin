import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const maxBodyBytes = 2048

function allowedOrigins() {
  const configured = (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').trim().replace(/\/$/, '')
  if (siteUrl) configured.push(siteUrl)
  return new Set(configured)
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin')?.replace(/\/$/, '') ?? ''
  const allowed = allowedOrigins()
  return {
    'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

const json = (request: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), ...extraHeaders, 'Content-Type': 'application/json' },
  })

function clientIp(request: Request) {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request)
  const origin = request.headers.get('Origin')?.replace(/\/$/, '') ?? ''
  if (origin && headers['Access-Control-Allow-Origin'] === 'null') {
    return json(request, { error: 'Origin is not allowed.' }, 403)
  }
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return json(request, { error: 'Request body is too large.' }, 413)
  }

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')

    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey || !siteUrl) {
      console.error('Missing payment service configuration')
      return json(request, { error: 'Payment service is not configured.' }, 500)
    }

    let body: { order_id?: unknown }
    try {
      body = await request.json()
    } catch {
      return json(request, { error: 'Invalid request body.' }, 400)
    }
    const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : ''
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return json(request, { error: 'A valid order_id is required.' }, 400)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const ip = clientIp(request)
    const rateChecks = [
      { key: `ip:${ip}`, window: 600, limit: 30 },
      { key: `order:${orderId}`, window: 300, limit: 8 },
    ]
    for (const check of rateChecks) {
      const { data, error } = await supabase.rpc('consume_edge_function_rate_limit', {
        p_function_name: 'create-checkout-session',
        p_subject_key: check.key,
        p_window_seconds: check.window,
        p_max_requests: check.limit,
      })
      if (error) {
        console.error('Checkout rate limit failed', error)
        return json(request, { error: 'Payment service is temporarily unavailable.' }, 503)
      }
      const result = data as { allowed?: boolean; retry_after_seconds?: number }
      if (!result.allowed) {
        return json(request, { error: 'Too many payment attempts. Please wait and try again.' }, 429, {
          'Retry-After': String(result.retry_after_seconds ?? check.window),
        })
      }
    }

    const stripe = new Stripe(stripeSecretKey)
    const { data: platformConfiguration, error: configurationError } = await supabase.rpc('get_public_platform_configuration')
    if (configurationError || !platformConfiguration) {
      console.error('Unable to verify platform ordering configuration', configurationError)
      return json(request, { error: 'Ordering controls could not be verified. Please try again shortly.' }, 503)
    }

    const controls = platformConfiguration as {
      maintenance_mode: boolean
      maintenance_message: string
      ordering_enabled: boolean
      ordering_pause_message: string
    }
    if (controls.maintenance_mode) return json(request, { error: controls.maintenance_message }, 409)
    if (!controls.ordering_enabled) return json(request, { error: controls.ordering_pause_message }, 409)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, order_number, customer_email, payment_status, order_status, total_pence, currency,
        delivery_fee_pence, service_fee_pence, stripe_checkout_session_id,
        restaurants!inner(name, slug), order_items(id, item_name, unit_price_pence, quantity)
      `)
      .eq('id', orderId)
      .single()

    if (orderError || !order) return json(request, { error: 'Order not found.' }, 404)
    if (order.payment_status === 'paid') return json(request, { error: 'This order has already been paid.' }, 409)
    if (order.order_status !== 'pending_payment') return json(request, { error: 'This order is no longer awaiting payment.' }, 409)
    if (!order.order_items?.length) return json(request, { error: 'This order has no items.' }, 400)

    if (order.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
        if (existing.status === 'open' && existing.url) {
          return json(request, { checkout_url: existing.url, session_id: existing.id })
        }
      } catch (error) {
        console.warn('Unable to reuse previous Checkout Session', error)
      }
    }

    const restaurant = Array.isArray(order.restaurants) ? order.restaurants[0] : order.restaurants
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.order_items.map((item: {
      item_name: string
      unit_price_pence: number
      quantity: number
    }) => ({
      quantity: item.quantity,
      price_data: {
        currency: order.currency,
        unit_amount: item.unit_price_pence,
        product_data: { name: item.item_name },
      },
    }))

    if (order.delivery_fee_pence > 0) lineItems.push({
      quantity: 1,
      price_data: { currency: order.currency, unit_amount: order.delivery_fee_pence, product_data: { name: 'Delivery fee' } },
    })
    if (order.service_fee_pence > 0) lineItems.push({
      quantity: 1,
      price_data: { currency: order.currency, unit_amount: order.service_fee_pence, product_data: { name: 'ordered.food service fee' } },
    })

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: order.customer_email,
      line_items: lineItems,
      success_url: `${siteUrl}/r/${restaurant.slug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/r/${restaurant.slug}/checkout?payment=cancelled`,
      client_reference_id: order.id,
      metadata: { order_id: order.id, order_number: String(order.order_number), restaurant_slug: restaurant.slug },
      payment_intent_data: {
        description: `${restaurant.name} order #${order.order_number}`,
        receipt_email: order.customer_email,
        metadata: { order_id: order.id, order_number: String(order.order_number), restaurant_slug: restaurant.slug },
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }, { idempotencyKey: `ordered-food-order-${order.id}` })

    if (!session.url) return json(request, { error: 'Payment provider did not return a checkout URL.' }, 502)

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        payment_status: 'pending',
      })
      .eq('id', order.id)
      .eq('order_status', 'pending_payment')

    if (updateError) {
      console.error('Failed to save Stripe Checkout Session', updateError)
      return json(request, { error: 'Unable to attach payment session to the order.' }, 500)
    }

    return json(request, { checkout_url: session.url, session_id: session.id })
  } catch (error) {
    console.error('Unexpected checkout error', error)
    return json(request, { error: 'Unable to create payment session. Please try again.' }, 500)
  }
})
