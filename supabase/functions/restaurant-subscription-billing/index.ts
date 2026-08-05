import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const trimOrigin=(value:string)=>value.trim().replace(/\/$/,'')
function cors(request:Request){const origin=trimOrigin(request.headers.get('Origin')??'');const allowed=new Set(['https://ordered.food','https://www.ordered.food',trimOrigin(Deno.env.get('SITE_URL')??''),...(Deno.env.get('CORS_ALLOWED_ORIGINS')??'').split(',').map(trimOrigin)].filter(Boolean));return{'Access-Control-Allow-Origin':origin&&allowed.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Max-Age':'86400','Vary':'Origin'}}
function json(request:Request,body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors(request),'Content-Type':'application/json','Cache-Control':'no-store'}})}

Deno.serve(async(request)=>{
  const headers=cors(request)
  if(request.method==='OPTIONS')return new Response('ok',{headers})
  if(request.method!=='POST')return json(request,{error:'Method not allowed.'},405)
  if(request.headers.get('Origin')&&headers['Access-Control-Allow-Origin']==='null')return json(request,{error:'Origin is not allowed.'},403)

  const stripeKey=Deno.env.get('STRIPE_SECRET_KEY')
  const supabaseUrl=Deno.env.get('SUPABASE_URL')
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const siteUrl=trimOrigin(Deno.env.get('SITE_URL')??'')
  const authHeader=request.headers.get('Authorization')
  if(!stripeKey||!supabaseUrl||!serviceKey||!siteUrl||!authHeader)return json(request,{error:'Subscription billing is not configured.'},500)

  let body:{action?:unknown;plan_id?:unknown;billing_interval?:unknown}
  try{body=await request.json()}catch{return json(request,{error:'Invalid request body.'},400)}
  const action=body.action==='status'||body.action==='checkout'||body.action==='portal'?body.action:''
  if(!action)return json(request,{error:'Unsupported subscription action.'},400)

  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const token=authHeader.replace(/^Bearer\s+/i,'')
  const{data:userData}=await admin.auth.getUser(token)
  if(!userData.user)return json(request,{error:'Authentication required.'},401)

  const{data:membership,error:membershipError}=await admin.from('restaurant_members').select('restaurant_id,restaurants(id,name,email)').eq('user_id',userData.user.id).limit(1).maybeSingle()
  if(membershipError||!membership)return json(request,{error:'Restaurant membership not found.'},403)
  const restaurant=Array.isArray(membership.restaurants)?membership.restaurants[0]:membership.restaurants
  if(!restaurant)return json(request,{error:'Restaurant not found.'},404)

  if(action==='status'){
    const{data,error}=await admin.rpc('get_restaurant_subscription_status')
    if(error)return json(request,{error:error.message},500)
    return json(request,data)
  }

  const stripe=new Stripe(stripeKey)
  let{data:subscription}=await admin.from('restaurant_subscriptions').select('*,subscription_plans(*)').eq('restaurant_id',membership.restaurant_id).maybeSingle()

  async function ensureCustomer(){
    if(subscription?.stripe_customer_id)return subscription.stripe_customer_id
    const customer=await stripe.customers.create({email:restaurant.email??userData.user.email??undefined,name:restaurant.name,metadata:{restaurant_id:membership.restaurant_id}},{idempotencyKey:`restaurant-subscription-customer-${membership.restaurant_id}`})
    if(subscription){
      const{data:updated,error}=await admin.from('restaurant_subscriptions').update({stripe_customer_id:customer.id,updated_at:new Date().toISOString()}).eq('id',subscription.id).select('*,subscription_plans(*)').single()
      if(error)throw error
      subscription=updated
    }
    return customer.id
  }

  if(action==='portal'){
    if(!subscription?.stripe_customer_id)return json(request,{error:'No subscription billing account exists yet.'},409)
    const session=await stripe.billingPortal.sessions.create({customer:subscription.stripe_customer_id,return_url:`${siteUrl}/subscription`})
    return json(request,{url:session.url})
  }

  const planId=typeof body.plan_id==='string'?body.plan_id:''
  const interval=body.billing_interval==='annual'?'annual':'monthly'
  if(!/^[0-9a-f-]{36}$/i.test(planId))return json(request,{error:'Choose a valid subscription plan.'},400)
  const{data:plan,error:planError}=await admin.from('subscription_plans').select('*').eq('id',planId).eq('is_active',true).single()
  if(planError||!plan)return json(request,{error:'Subscription plan not found.'},404)
  const priceId=interval==='annual'?plan.stripe_annual_price_id:plan.stripe_monthly_price_id
  if(!priceId)return json(request,{error:`Stripe price is not configured for the ${plan.name} ${interval} plan.`},409)

  if(subscription?.status==='active'||subscription?.status==='trialing')return json(request,{error:'Manage your current subscription from the billing portal.'},409)
  const customerId=await ensureCustomer()
  const checkout=await stripe.checkout.sessions.create({
    mode:'subscription',
    customer:customerId,
    line_items:[{price:priceId,quantity:1}],
    subscription_data:{trial_period_days:plan.trial_days,metadata:{restaurant_id:membership.restaurant_id,plan_id:plan.id,billing_interval:interval}},
    success_url:`${siteUrl}/subscription?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`${siteUrl}/subscription?subscription=cancelled`,
    client_reference_id:membership.restaurant_id,
    metadata:{restaurant_id:membership.restaurant_id,plan_id:plan.id,billing_interval:interval},
    allow_promotion_codes:true,
  },{idempotencyKey:`restaurant-subscription-checkout-${membership.restaurant_id}-${plan.id}-${interval}`})

  await admin.from('restaurant_subscriptions').upsert({restaurant_id:membership.restaurant_id,plan_id:plan.id,status:'incomplete',billing_interval:interval,stripe_customer_id:customerId,updated_at:new Date().toISOString()},{onConflict:'restaurant_id'})
  return json(request,{url:checkout.url,session_id:checkout.id})
})
