import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')
  const authHeader = request.headers.get('Authorization')

  if (!stripeKey || !supabaseUrl || !serviceRoleKey || !siteUrl || !authHeader) {
    return json({ error: 'Stripe Connect is not configured.' }, 500)
  }

  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (userError || !userData.user) return json({ error: 'Authentication required.' }, 401)

  let body: { action?: string }
  try { body = await request.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const action = body.action ?? 'status'
  if (!['status', 'onboard', 'dashboard'].includes(action)) return json({ error: 'Unsupported action.' }, 400)

  const { data: membership, error: membershipError } = await serviceClient
    .from('restaurant_members')
    .select('restaurant_id, restaurants!inner(id,name,email,stripe_account_id)')
    .eq('user_id', userData.user.id)
    .limit(1)
    .single()

  if (membershipError || !membership) return json({ error: 'Restaurant membership not found.' }, 403)

  const restaurant = Array.isArray(membership.restaurants) ? membership.restaurants[0] : membership.restaurants
  const stripe = new Stripe(stripeKey)
  let accountId = restaurant.stripe_account_id as string | null

  if (!accountId) {
    if (action === 'dashboard') return json({ error: 'Connect Stripe before opening the dashboard.' }, 409)
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      email: restaurant.email ?? userData.user.email ?? undefined,
      business_type: 'company',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { restaurant_id: restaurant.id, restaurant_name: restaurant.name },
    })
    accountId = account.id
  }

  const account = await stripe.accounts.retrieve(accountId)
  const requirements = {
    currently_due: account.requirements?.currently_due ?? [],
    eventually_due: account.requirements?.eventually_due ?? [],
    past_due: account.requirements?.past_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  }

  await serviceClient.rpc('update_restaurant_stripe_connect_status', {
    p_restaurant_id: restaurant.id,
    p_stripe_account_id: account.id,
    p_details_submitted: account.details_submitted,
    p_charges_enabled: account.charges_enabled,
    p_payouts_enabled: account.payouts_enabled,
    p_requirements: requirements,
  })

  if (action === 'onboard') {
    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${siteUrl}/payments?stripe=refresh`,
      return_url: `${siteUrl}/payments?stripe=return`,
      type: 'account_onboarding',
    })
    return json({ url: link.url })
  }

  if (action === 'dashboard') {
    if (!account.details_submitted) return json({ error: 'Complete Stripe onboarding first.' }, 409)
    const loginLink = await stripe.accounts.createLoginLink(account.id)
    return json({ url: loginLink.url })
  }

  return json({
    restaurant_id: restaurant.id,
    stripe_account_id: account.id,
    status: account.charges_enabled && account.payouts_enabled ? 'enabled' : account.details_submitted ? 'restricted' : 'pending',
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    requirements,
  })
})
