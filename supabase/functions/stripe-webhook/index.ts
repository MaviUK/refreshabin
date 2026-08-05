import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 1024 * 1024
const MAX_EVENT_AGE_SECONDS = 4 * 24 * 60 * 60
const MAX_FUTURE_SKEW_SECONDS = 5 * 60
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const paymentIntentId = (value: string | Stripe.PaymentIntent | null) => !value ? null : typeof value === 'string' ? value : value.id
const idOf = (value: string | { id: string } | null | undefined) => !value ? null : typeof value === 'string' ? value : value.id
const toIso = (unix: number | null | undefined) => unix ? new Date(unix * 1000).toISOString() : null

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json({ error: 'Webhook payload is too large.' }, 413)

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) return json({ error: 'Webhook is not configured.' }, 500)

  const signature = request.headers.get('stripe-signature')
  if (!signature) return json({ error: 'Missing Stripe signature.' }, 400)
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: 'Webhook payload is too large.' }, 413)

  const stripe = new Stripe(stripeSecretKey)
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, 300, Stripe.createSubtleCryptoProvider())
  } catch {
    return json({ error: 'Invalid Stripe signature.' }, 400)
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (event.created < nowSeconds - MAX_EVENT_AGE_SECONDS || event.created > nowSeconds + MAX_FUTURE_SKEW_SECONDS) return json({ error: 'Stripe event is outside the accepted time window.' }, 400)

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: claim, error: claimError } = await supabase.rpc('claim_stripe_webhook_event', { p_event_id: event.id, p_event_type: event.type })
  if (claimError) return json({ error: 'Unable to process webhook.' }, 500)
  if (!(claim as { claimed?: boolean } | null)?.claimed) return json({ received: true, duplicate: true })

  async function upsertSubscription(subscription: Stripe.Subscription, eventType: string) {
    const restaurantId = subscription.metadata?.restaurant_id
    const planId = subscription.metadata?.plan_id
    if (!restaurantId) throw new Error('Stripe subscription is missing restaurant metadata')
    const statusMap: Record<string, string> = {
      incomplete: 'incomplete', incomplete_expired: 'unpaid', trialing: 'trialing', active: 'active',
      past_due: 'past_due', canceled: 'cancelled', unpaid: 'unpaid', paused: 'paused',
    }
    const status = statusMap[subscription.status] ?? 'incomplete'
    const grace = status === 'past_due' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
    const payload = {
      restaurant_id: restaurantId,
      plan_id: planId || null,
      stripe_customer_id: idOf(subscription.customer),
      stripe_subscription_id: subscription.id,
      status,
      billing_interval: subscription.metadata?.billing_interval === 'annual' ? 'annual' : 'monthly',
      trial_started_at: toIso(subscription.trial_start),
      trial_ends_at: toIso(subscription.trial_end),
      current_period_start: toIso(subscription.current_period_start),
      current_period_end: toIso(subscription.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end,
      cancelled_at: toIso(subscription.canceled_at),
      grace_period_ends_at: grace,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('restaurant_subscriptions').upsert(payload, { onConflict: 'restaurant_id' }).select('id').single()
    if (error) throw error
    await supabase.from('restaurant_subscription_events').insert({
      restaurant_id: restaurantId,
      subscription_id: data.id,
      event_type: eventType,
      stripe_event_id: event.id,
      details: { stripe_status: subscription.status, cancel_at_period_end: subscription.cancel_at_period_end },
    })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'subscription') {
          const subscriptionId = idOf(session.subscription)
          if (!subscriptionId) throw new Error('Subscription checkout is missing a subscription')
          const subscription = await stripe.subscriptions.retrieve(subscriptionId)
          await upsertSubscription(subscription, 'checkout_completed')
          break
        }
        const orderId = session.metadata?.order_id ?? session.client_reference_id
        if (!orderId) throw new Error('Checkout Session is missing order metadata')
        const intentId = paymentIntentId(session.payment_intent)
        if (!intentId) throw new Error('Checkout Session is missing a PaymentIntent')
        const intent = await stripe.paymentIntents.retrieve(intentId)
        if (intent.status !== 'requires_capture' && intent.status !== 'succeeded') break
        const authorized = intent.status === 'requires_capture'
        const { error } = await supabase.from('orders').update({ payment_status: authorized ? 'authorized' : 'paid', order_status: 'placed', paid_at: authorized ? null : new Date(event.created * 1000).toISOString(), stripe_checkout_session_id: session.id, stripe_payment_intent_id: intent.id }).eq('id', orderId).in('payment_status', ['pending', 'requires_action'])
        if (error) throw error
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(event.data.object as Stripe.Subscription, event.type)
        break
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = idOf(invoice.subscription)
        if (!subscriptionId) break
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        await upsertSubscription(subscription, 'invoice_payment_succeeded')
        const restaurantId = subscription.metadata?.restaurant_id
        if (restaurantId) {
          await supabase.from('restaurant_subscriptions').update({
            stripe_latest_invoice_id: invoice.id,
            last_payment_succeeded_at: new Date(event.created * 1000).toISOString(),
            last_payment_failed_at: null,
            grace_period_ends_at: null,
            status: subscription.status === 'trialing' ? 'trialing' : 'active',
            updated_at: new Date().toISOString(),
          }).eq('restaurant_id', restaurantId)
        }
        break
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = idOf(invoice.subscription)
        if (!subscriptionId) break
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const restaurantId = subscription.metadata?.restaurant_id
        if (!restaurantId) break
        const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data: row, error } = await supabase.from('restaurant_subscriptions').update({
          stripe_latest_invoice_id: invoice.id,
          status: 'past_due',
          last_payment_failed_at: new Date(event.created * 1000).toISOString(),
          grace_period_ends_at: gracePeriodEndsAt,
          updated_at: new Date().toISOString(),
        }).eq('restaurant_id', restaurantId).select('id').single()
        if (error) throw error
        await supabase.from('restaurant_subscription_events').insert({ restaurant_id: restaurantId, subscription_id: row.id, event_type: 'invoice_payment_failed', stripe_event_id: event.id, details: { invoice_id: invoice.id, grace_period_ends_at: gracePeriodEndsAt } })
        break
      }
      case 'payment_intent.amount_capturable_updated': {
        const intent = event.data.object as Stripe.PaymentIntent
        const orderId = intent.metadata?.order_id
        if (!orderId || intent.status !== 'requires_capture') break
        const { error } = await supabase.from('orders').update({ payment_status: 'authorized', order_status: 'placed', stripe_payment_intent_id: intent.id }).eq('id', orderId).in('payment_status', ['pending', 'requires_action'])
        if (error) throw error
        break
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent
        const orderId = intent.metadata?.order_id
        if (!orderId) break
        const { error } = await supabase.from('orders').update({ payment_status: 'paid', paid_at: new Date(event.created * 1000).toISOString(), stripe_payment_intent_id: intent.id }).eq('id', orderId).neq('payment_status', 'paid')
        if (error) throw error
        break
      }
      case 'payment_intent.canceled': {
        const intent = event.data.object as Stripe.PaymentIntent
        const orderId = intent.metadata?.order_id
        if (!orderId) break
        const { error } = await supabase.from('orders').update({ payment_status: 'cancelled', stripe_payment_intent_id: intent.id, manual_payout_status: 'not_applicable' }).eq('id', orderId).eq('payment_status', 'authorized')
        if (error) throw error
        break
      }
      case 'payment_intent.payment_failed':
      case 'checkout.session.async_payment_failed': {
        const object = event.data.object as Stripe.PaymentIntent | Stripe.Checkout.Session
        const orderId = object.metadata?.order_id
        if (!orderId) break
        const updates: Record<string, unknown> = { payment_status: 'failed' }
        if ('payment_intent' in object) updates.stripe_payment_intent_id = paymentIntentId(object.payment_intent)
        else updates.stripe_payment_intent_id = object.id
        const { error } = await supabase.from('orders').update(updates).eq('id', orderId).eq('order_status', 'pending_payment')
        if (error) throw error
        break
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const intentId = paymentIntentId(charge.payment_intent)
        if (!intentId) break
        const paymentStatus = charge.amount_refunded >= charge.amount ? 'refunded' : 'partially_refunded'
        const { error } = await supabase.from('orders').update({ payment_status: paymentStatus, refunded_pence: charge.amount_refunded, last_refunded_at: new Date(event.created * 1000).toISOString() }).eq('stripe_payment_intent_id', intentId)
        if (error) throw error
        break
      }
      default:
        console.log('Ignoring unhandled Stripe event', { eventId: event.id, type: event.type })
    }

    const { error: completeError } = await supabase.rpc('complete_stripe_webhook_event', { p_event_id: event.id, p_succeeded: true, p_error_message: null })
    if (completeError) throw completeError
    return json({ received: true })
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : 'Webhook processing failed'
    console.error('Failed to process Stripe webhook', { eventId: event.id, type: event.type, message: internalMessage })
    await supabase.rpc('complete_stripe_webhook_event', { p_event_id: event.id, p_succeeded: false, p_error_message: internalMessage })
    return json({ error: 'Webhook processing failed.' }, 500)
  }
})
