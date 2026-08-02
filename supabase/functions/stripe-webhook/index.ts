import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const paymentIntentId = (value: string | Stripe.PaymentIntent | null) => {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('Missing Stripe or Supabase environment variables')
    return json({ error: 'Webhook is not configured.' }, 500)
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return json({ error: 'Missing Stripe signature.' }, 400)

  const stripe = new Stripe(stripeSecretKey)
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch (error) {
    console.error('Invalid Stripe signature', error)
    return json({ error: 'Invalid Stripe signature.' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: processedEvent, error: processedEventError } = await supabase
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle()

  if (processedEventError) {
    console.error('Unable to check webhook idempotency', processedEventError)
    return json({ error: 'Unable to process webhook.' }, 500)
  }

  if (processedEvent) return json({ received: true, duplicate: true })

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session
        const orderId = session.metadata?.order_id ?? session.client_reference_id

        if (!orderId) throw new Error('Stripe Checkout Session is missing order_id metadata.')
        if (session.payment_status !== 'paid') break

        const { error } = await supabase
          .from('orders')
          .update({
            payment_status: 'paid',
            order_status: 'placed',
            paid_at: new Date().toISOString(),
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: paymentIntentId(session.payment_intent),
          })
          .eq('id', orderId)
          .neq('payment_status', 'paid')

        if (error) throw error
        break
      }

      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent
        const orderId = intent.metadata?.order_id

        if (!orderId) break

        const { error } = await supabase
          .from('orders')
          .update({
            payment_status: 'paid',
            order_status: 'placed',
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: intent.id,
          })
          .eq('id', orderId)
          .neq('payment_status', 'paid')

        if (error) throw error
        break
      }

      case 'payment_intent.payment_failed':
      case 'checkout.session.async_payment_failed': {
        const object = event.data.object as Stripe.PaymentIntent | Stripe.Checkout.Session
        const orderId = 'metadata' in object
          ? object.metadata?.order_id
          : null

        if (!orderId) break

        const updates: Record<string, unknown> = { payment_status: 'failed' }
        if ('payment_intent' in object) {
          updates.stripe_payment_intent_id = paymentIntentId(object.payment_intent)
        } else {
          updates.stripe_payment_intent_id = object.id
        }

        const { error } = await supabase
          .from('orders')
          .update(updates)
          .eq('id', orderId)
          .eq('order_status', 'pending_payment')

        if (error) throw error
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const intentId = paymentIntentId(charge.payment_intent)

        if (!intentId) break

        const paymentStatus = charge.amount_refunded >= charge.amount
          ? 'refunded'
          : 'partially_refunded'

        const { error } = await supabase
          .from('orders')
          .update({ payment_status: paymentStatus, refunded_pence: charge.amount_refunded, last_refunded_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', intentId)

        if (error) throw error
        break
      }

      default:
        console.log(`Ignoring unhandled Stripe event: ${event.type}`)
    }

    const { error: eventInsertError } = await supabase
      .from('stripe_webhook_events')
      .insert({ event_id: event.id, event_type: event.type })

    if (eventInsertError && eventInsertError.code !== '23505') throw eventInsertError

    return json({ received: true })
  } catch (error) {
    console.error(`Failed to process Stripe event ${event.id}`, error)
    return json({ error: 'Webhook processing failed.' }, 500)
  }
})
