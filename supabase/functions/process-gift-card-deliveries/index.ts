import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_BODY_BYTES = 1024

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character))
}

async function sendEmail(apiKey: string, from: string, to: string, subject: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}`)
}

function recipientHtml(restaurantName: string, recipientName: string | null, code: string, valuePence: number, message: string | null) {
  const safeRestaurant = escapeHtml(restaurantName)
  const safeName = escapeHtml(recipientName || 'You')
  const safeMessage = message ? `<p style="font-size:16px;line-height:1.6;color:#4b453e">${escapeHtml(message)}</p>` : ''
  const amount = `£${(valuePence / 100).toFixed(2)}`
  return `<div style="font-family:Arial,sans-serif;background:#f6f3ed;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px"><p style="font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#756d63">ordered.food gift card</p><h1 style="font-size:30px;margin:8px 0 16px">${safeName}, you have a ${amount} gift card</h1><p style="font-size:17px;color:#4b453e">Use it when ordering from <strong>${safeRestaurant}</strong>.</p>${safeMessage}<div style="margin:28px 0;padding:22px;border-radius:14px;background:#171615;color:#fff;text-align:center"><span style="display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Gift card code</span><strong style="display:block;font-size:25px;margin-top:10px;letter-spacing:.08em">${escapeHtml(code)}</strong></div><p style="color:#746c63">Enter this code during checkout. Partial balances remain available for future orders.</p></div></div>`
}

function purchaserHtml(restaurantName: string, recipientEmail: string, valuePence: number, deliveryAt: string, purchaseId: string) {
  const amount = `£${(valuePence / 100).toFixed(2)}`
  const delivery = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(deliveryAt))
  return `<div style="font-family:Arial,sans-serif;background:#f6f3ed;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px"><p style="font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#756d63">ordered.food receipt</p><h1 style="font-size:30px;margin:8px 0 16px">Gift card purchase confirmed</h1><p style="font-size:17px;color:#4b453e">You purchased a <strong>${amount}</strong> gift card for <strong>${escapeHtml(restaurantName)}</strong>.</p><p style="color:#4b453e">Recipient: ${escapeHtml(recipientEmail)}<br>Delivery: ${escapeHtml(delivery)}</p><p style="color:#746c63">Reference: ${escapeHtml(purchaseId)}</p></div></div>`
}

type Purchase = {
  id: string
  restaurant_id: string
  purchaser_email: string
  recipient_email: string
  recipient_name: string | null
  message: string | null
  value_pence: number
  delivery_at: string
  stripe_checkout_session_id: string | null
  gift_card_id: string | null
  status: string
  email_sent_at: string | null
  purchaser_email_sent_at: string | null
  restaurants: { name: string; slug: string } | { name: string; slug: string }[]
  restaurant_gift_cards: { code: string } | { code: string }[] | null
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed.' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  const length = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return new Response(JSON.stringify({ error: 'Request body is too large.' }), { status: 413, headers: { 'Content-Type': 'application/json' } })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM_EMAIL') || 'ordered.food <orders@ordered.food>'
  if (!url || !serviceKey || !stripeKey || !resendKey) return new Response(JSON.stringify({ error: 'Gift card processing is not configured.' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const stripe = new Stripe(stripeKey)
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('gift_card_purchases')
    .select('id,restaurant_id,purchaser_email,recipient_email,recipient_name,message,value_pence,delivery_at,stripe_checkout_session_id,gift_card_id,status,email_sent_at,purchaser_email_sent_at,restaurants(name,slug),restaurant_gift_cards(code)')
    .or(`and(status.eq.pending,stripe_checkout_session_id.not.is.null),and(status.eq.issued,email_sent_at.is.null,delivery_at.lte.${now})`)
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) return new Response(JSON.stringify({ error: 'Unable to load gift card queue.' }), { status: 500, headers: { 'Content-Type': 'application/json' } })

  const results: Array<{ id: string; status: string; error?: string }> = []
  for (const row of (data ?? []) as Purchase[]) {
    try {
      let purchase = row
      if (purchase.status === 'pending' && purchase.stripe_checkout_session_id) {
        const session = await stripe.checkout.sessions.retrieve(purchase.stripe_checkout_session_id)
        if (session.payment_status !== 'paid') {
          results.push({ id: purchase.id, status: 'awaiting_payment' })
          continue
        }
        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || ''
        const { error: issueError } = await db.rpc('issue_paid_gift_card_purchase', { p_purchase_id: purchase.id, p_session_id: session.id, p_payment_intent_id: paymentIntentId })
        if (issueError) throw issueError
        const { data: refreshed, error: refreshError } = await db.from('gift_card_purchases').select('id,restaurant_id,purchaser_email,recipient_email,recipient_name,message,value_pence,delivery_at,stripe_checkout_session_id,gift_card_id,status,email_sent_at,purchaser_email_sent_at,restaurants(name,slug),restaurant_gift_cards(code)').eq('id', purchase.id).single()
        if (refreshError || !refreshed) throw refreshError || new Error('Issued purchase could not be reloaded')
        purchase = refreshed as Purchase
      }

      const restaurant = Array.isArray(purchase.restaurants) ? purchase.restaurants[0] : purchase.restaurants
      const card = Array.isArray(purchase.restaurant_gift_cards) ? purchase.restaurant_gift_cards[0] : purchase.restaurant_gift_cards
      if (!restaurant || !card) throw new Error('Gift card relationship data is incomplete')

      if (!purchase.purchaser_email_sent_at) {
        await sendEmail(resendKey, from, purchase.purchaser_email, `Gift card purchase confirmed · ${restaurant.name}`, purchaserHtml(restaurant.name, purchase.recipient_email, purchase.value_pence, purchase.delivery_at, purchase.id))
        await db.from('gift_card_purchases').update({ purchaser_email_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', purchase.id)
      }

      if (!purchase.email_sent_at && new Date(purchase.delivery_at).getTime() <= Date.now()) {
        await sendEmail(resendKey, from, purchase.recipient_email, `Your ${restaurant.name} gift card`, recipientHtml(restaurant.name, purchase.recipient_name, card.code, purchase.value_pence, purchase.message))
        await db.from('gift_card_purchases').update({ email_sent_at: new Date().toISOString(), delivery_attempted_at: new Date().toISOString(), delivery_error: null, updated_at: new Date().toISOString() }).eq('id', purchase.id)
        results.push({ id: purchase.id, status: 'delivered' })
      } else {
        results.push({ id: purchase.id, status: 'issued' })
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.slice(0, 500) : 'Gift card processing failed'
      await db.from('gift_card_purchases').update({ delivery_attempted_at: new Date().toISOString(), delivery_error: message, updated_at: new Date().toISOString() }).eq('id', row.id)
      results.push({ id: row.id, status: 'failed', error: message })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
})
