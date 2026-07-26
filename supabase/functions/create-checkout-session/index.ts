import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')

    if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey || !siteUrl) {
      console.error('Missing STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SITE_URL')
      return json({ error: 'Payment service is not configured.' }, 500)
    }

    const { order_id: orderId } = await request.json()
    if (!orderId || typeof orderId !== 'string') return json({ error: 'order_id is required.' }, 400)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const stripe = new Stripe(stripeSecretKey)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        customer_email,
        payment_status,
        order_status,
        total_pence,
        currency,
        delivery_fee_pence,
        stripe_checkout_session_id,
        restaurants!inner(name, slug),
        order_items(id, item_name, unit_price_pence, quantity)
      `)
      .eq('id', orderId)
      .single()

    if (orderError || !order) return json({ error: 'Order not found.' }, 404)
    if (order.payment_status === 'paid') return json({ error: 'This order has already been paid.' }, 409)
    if (order.order_status !== 'pending_payment') return json({ error: 'This order is no longer awaiting payment.' }, 409)
    if (!order.order_items?.length) return json({ error: 'This order has no items.' }, 400)

    if (order.stripe_checkout_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id)
        if (existing.status === 'open' && existing.url) {
          return json({ checkout_url: existing.url, session_id: existing.id })
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

    if (order.delivery_fee_pence > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: order.currency,
          unit_amount: order.delivery_fee_pence,
          product_data: { name: 'Delivery fee' },
        },
      })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: order.customer_email,
      line_items: lineItems,
      success_url: `${siteUrl}/r/${restaurant.slug}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/r/${restaurant.slug}/checkout?payment=cancelled`,
      client_reference_id: order.id,
      metadata: {
        order_id: order.id,
        order_number: String(order.order_number),
        restaurant_slug: restaurant.slug,
      },
      payment_intent_data: {
        description: `${restaurant.name} order #${order.order_number}`,
        receipt_email: order.customer_email,
        metadata: {
          order_id: order.id,
          order_number: String(order.order_number),
          restaurant_slug: restaurant.slug,
        },
      },
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60),
    }, {
      idempotencyKey: `ordered-food-order-${order.id}`,
    })

    if (!session.url) return json({ error: 'Stripe did not return a checkout URL.' }, 502)

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
      return json({ error: 'Unable to attach payment session to the order.' }, 500)
    }

    return json({ checkout_url: session.url, session_id: session.id })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Unable to create payment session.' }, 500)
  }
})
