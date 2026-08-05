import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const normalize = (value: string) => value.trim().replace(/\/$/, '')
function cors(request: Request) {
  const origin = normalize(request.headers.get('Origin') ?? '')
  const allowed = new Set(['https://ordered.food','https://www.ordered.food',normalize(Deno.env.get('SITE_URL') ?? ''),...(Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '').split(',').map(normalize)].filter(Boolean))
  return {'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : 'null','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Max-Age':'86400','Vary':'Origin'}
}
function respond(request: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors(request), 'Content-Type':'application/json','Cache-Control':'no-store' } }) }
function errorDetails(error: unknown) {
  if (error instanceof Error) return { message:error.message, type:error.name }
  if (error && typeof error === 'object') { const value=error as Record<string,unknown>; const raw=value.raw&&typeof value.raw==='object'?value.raw as Record<string,unknown>:undefined; return { message:typeof value.message==='string'?value.message:typeof raw?.message==='string'?raw.message:'Payment provider returned an unknown error.', code:typeof value.code==='string'?value.code:typeof raw?.code==='string'?raw.code:undefined, type:typeof value.type==='string'?value.type:typeof raw?.type==='string'?raw.type:undefined } }
  return { message: typeof error === 'string' ? error : 'Payment provider returned an unknown error.' }
}

Deno.serve(async (request) => {
  const corsHeaders = cors(request)
  if (request.method === 'OPTIONS') return new Response('ok', { status:200, headers:corsHeaders })
  if (request.method !== 'POST') return respond(request, { error:'Method not allowed.' }, 405)
  if (request.headers.get('Origin') && corsHeaders['Access-Control-Allow-Origin'] === 'null') return respond(request, { error:'Origin is not allowed.' }, 403)

  const stripeKey=Deno.env.get('STRIPE_SECRET_KEY'); const supabaseUrl=Deno.env.get('SUPABASE_URL'); const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); const siteUrl=normalize(Deno.env.get('SITE_URL') ?? '')
  if (!stripeKey || !supabaseUrl || !serviceRoleKey || !siteUrl) return respond(request, { error:'Payment service is not configured.' }, 500)
  let body:{order_id?:unknown}; try { body=await request.json() } catch { return respond(request,{error:'Invalid request body.'},400) }
  const orderId=typeof body.order_id==='string'?body.order_id.trim():''
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return respond(request,{error:'A valid order_id is required.'},400)

  const db=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}); const stripe=new Stripe(stripeKey)
  try {
    const { data:controls,error:controlsError }=await db.rpc('get_public_platform_configuration')
    if (controlsError||!controls) return respond(request,{error:'Ordering controls could not be verified.'},503)
    if (controls.maintenance_mode) return respond(request,{error:controls.maintenance_message},409)
    if (!controls.ordering_enabled) return respond(request,{error:controls.ordering_pause_message},409)

    const { data:order,error:orderError }=await db.from('orders').select(`id,order_number,customer_email,payment_status,order_status,total_pence,currency,subtotal_pence,discount_pence,promotion_code,delivery_fee_pence,service_fee_pence,platform_commission_pence,platform_commission_vat_pence,restaurant_net_pence,stripe_checkout_session_id,restaurants!inner(id,name,slug,stripe_account_id,stripe_connect_status,stripe_charges_enabled,stripe_payouts_enabled),order_items(id,item_name,unit_price_pence,quantity)`).eq('id',orderId).single()
    if (orderError||!order) return respond(request,{error:'Order not found.'},404)
    if (order.order_status!=='pending_payment') return respond(request,{error:'This order is no longer awaiting payment.'},409)
    if (['authorized','paid'].includes(order.payment_status)) return respond(request,{error:'This order already has a valid payment authorisation.'},409)
    if (!order.order_items?.length) return respond(request,{error:'This order has no items.'},400)
    if (!Number.isInteger(order.total_pence) || order.total_pence <= 0) return respond(request,{error:'Order total is invalid.'},409)

    const restaurant=Array.isArray(order.restaurants)?order.restaurants[0]:order.restaurants
    if (!restaurant) return respond(request,{error:'Restaurant payment settings could not be loaded.'},409)
    const connectEnabled=Boolean(restaurant.stripe_account_id&&restaurant.stripe_connect_status==='enabled'&&restaurant.stripe_charges_enabled&&restaurant.stripe_payouts_enabled)
    const payoutMode=connectEnabled?'stripe_connect':'platform_manual'

    if (order.stripe_checkout_session_id) { try { const existing=await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id); if (existing.status==='open'&&existing.url) return respond(request,{checkout_url:existing.url,session_id:existing.id,payout_mode:payoutMode}) } catch {} }

    const calculatedNet=Math.max(0,Number(order.subtotal_pence??0)+Number(order.delivery_fee_pence??0)-Number(order.discount_pence??0)-Number(order.platform_commission_pence??0)-Number(order.platform_commission_vat_pence??0))
    const storedNet=Number(order.restaurant_net_pence??0); const restaurantNet=Math.min(Number(order.total_pence),storedNet>0?storedNet:calculatedNet); const applicationFee=Math.max(0,Number(order.total_pence)-restaurantNet)
    if (connectEnabled&&restaurantNet<=0) return respond(request,{error:'Restaurant payout could not be calculated.'},409)
    if (applicationFee>=Number(order.total_pence)) return respond(request,{error:'Platform fee calculation is invalid.'},409)

    const orderDescription = order.discount_pence > 0 && order.promotion_code
      ? `${restaurant.name} order #${order.order_number} · ${order.promotion_code} applied`
      : `${restaurant.name} order #${order.order_number}`
    const lineItems:Stripe.Checkout.SessionCreateParams.LineItem[]=[{
      quantity:1,
      price_data:{
        currency:order.currency,
        unit_amount:order.total_pence,
        product_data:{name:`${restaurant.name} order #${order.order_number}`,description:orderDescription},
      },
    }]

    const metadata={order_id:order.id,order_number:String(order.order_number),restaurant_id:restaurant.id,restaurant_slug:restaurant.slug,restaurant_payout_mode:payoutMode,restaurant_net_pence:String(restaurantNet),application_fee_pence:String(applicationFee),promotion_code:order.promotion_code??'',discount_pence:String(order.discount_pence??0)}
    const paymentIntentData:Stripe.Checkout.SessionCreateParams.PaymentIntentData={capture_method:'manual',description:orderDescription,receipt_email:order.customer_email,metadata}
    if (connectEnabled) { paymentIntentData.transfer_data={destination:restaurant.stripe_account_id}; if (applicationFee>0) paymentIntentData.application_fee_amount=applicationFee }

    const session=await stripe.checkout.sessions.create({mode:'payment',customer_email:order.customer_email,line_items:lineItems,payment_method_types:['card'],success_url:`${siteUrl}/order/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,cancel_url:`${siteUrl}/r/${restaurant.slug}/checkout?payment=cancelled`,client_reference_id:order.id,metadata,payment_intent_data:paymentIntentData,expires_at:Math.floor(Date.now()/1000)+1800},{idempotencyKey:`ordered-food-authorise-v5-${payoutMode}-${order.id}-${order.total_pence}`})
    if (!session.url) return respond(request,{error:'Payment provider did not return a checkout URL.'},502)
    const { error:updateError }=await db.from('orders').update({stripe_checkout_session_id:session.id,stripe_payment_intent_id:typeof session.payment_intent==='string'?session.payment_intent:null,payment_status:'pending',restaurant_net_pence:restaurantNet,restaurant_payout_mode:payoutMode,manual_payout_status:connectEnabled?'not_applicable':'unsettled'}).eq('id',order.id).eq('order_status','pending_payment')
    if (updateError) return respond(request,{error:updateError.message,details:{code:updateError.code}},500)
    return respond(request,{checkout_url:session.url,session_id:session.id,payout_mode:payoutMode,capture_method:'manual',restaurant_net_pence:restaurantNet,application_fee_pence:applicationFee})
  } catch (error) { const details=errorDetails(error); console.error('Checkout failure',JSON.stringify(details)); return respond(request,{error:details.message,details},500) }
})
