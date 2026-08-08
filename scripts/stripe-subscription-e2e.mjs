#!/usr/bin/env node

const validateOnly=process.argv.includes('--validate-only')
const key=process.env.STRIPE_TEST_SECRET_KEY||''

function assertTestKey(value,{allowMissing=false}={}){
  if(!value){if(allowMissing)return;throw new Error('STRIPE_TEST_SECRET_KEY is required for Stripe lifecycle E2E.')}
  if(value.startsWith('sk_live_'))throw new Error('Refusing to run Stripe E2E with a live secret key.')
  if(!value.startsWith('sk_test_'))throw new Error('Stripe E2E requires an sk_test_ secret key.')
}

if(validateOnly){assertTestKey(key,{allowMissing:true});console.log('Stripe E2E safety guard valid. Live keys are rejected; missing test key is allowed for build-only CI.');process.exit(0)}
assertTestKey(key)

const api='https://api.stripe.com/v1'
const created={customers:[],products:[]}
const form=(data)=>{const p=new URLSearchParams();for(const[key,value]of Object.entries(data)){if(value===undefined||value===null)continue;p.set(key,String(value))}return p}
async function stripe(path,{method='GET',data}={}){const response=await fetch(`${api}${path}`,{method,headers:{Authorization:`Bearer ${key}`,...(data?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:data?form(data):undefined});const json=await response.json();if(!response.ok)throw new Error(`${method} ${path}: ${json?.error?.message||response.status}`);return json}
async function cleanup(){for(const id of created.customers.reverse()){try{await stripe(`/customers/${id}`,{method:'DELETE'})}catch{}}for(const id of created.products.reverse()){try{await stripe(`/products/${id}`,{method:'POST',data:{active:false}})}catch{}}}

const checks=[]
const check=(name,ok,detail='')=>{if(!ok)throw new Error(`${name} failed${detail?`: ${detail}`:''}`);checks.push(name);console.log(`✓ ${name}`)}

try{
  const balance=await stripe('/balance')
  check('Stripe account is test mode',balance.livemode===false)

  const customer=await stripe('/customers',{method:'POST',data:{email:`ordered-food-e2e-${Date.now()}@example.test`,name:'ordered.food Stripe E2E','metadata[test_suite]':'phase_5_10'}});created.customers.push(customer.id)
  const product=await stripe('/products',{method:'POST',data:{name:`ordered.food E2E ${Date.now()}`,'metadata[test_suite]':'phase_5_10'}});created.products.push(product.id)
  const priceA=await stripe('/prices',{method:'POST',data:{currency:'gbp',unit_amount:2900,'recurring[interval]':'month',product:product.id}})
  const priceB=await stripe('/prices',{method:'POST',data:{currency:'gbp',unit_amount:5900,'recurring[interval]':'month',product:product.id}})

  const pm=await stripe('/payment_methods',{method:'POST',data:{type:'card','card[token]':'tok_visa'}})
  await stripe(`/payment_methods/${pm.id}/attach`,{method:'POST',data:{customer:customer.id}})
  await stripe(`/customers/${customer.id}`,{method:'POST',data:{'invoice_settings[default_payment_method]':pm.id}})

  let subscription=await stripe('/subscriptions',{method:'POST',data:{customer:customer.id,'items[0][price]':priceA.id,'payment_behavior':'error_if_incomplete','metadata[test_suite]':'phase_5_10'}})
  check('Subscription creation',['active','trialing'].includes(subscription.status),subscription.status)

  const item=subscription.items.data[0]
  subscription=await stripe(`/subscriptions/${subscription.id}`,{method:'POST',data:{[`items[0][id]`]:item.id,[`items[0][price]`]:priceB.id,proration_behavior:'create_prorations'}})
  check('Plan upgrade',subscription.items.data[0]?.price?.id===priceB.id)

  subscription=await stripe(`/subscriptions/${subscription.id}`,{method:'POST',data:{'pause_collection[behavior]':'void'}})
  check('Pause collection',subscription.pause_collection?.behavior==='void')
  subscription=await stripe(`/subscriptions/${subscription.id}`,{method:'POST',data:{pause_collection:''}})
  check('Resume collection',subscription.pause_collection===null)

  subscription=await stripe(`/subscriptions/${subscription.id}`,{method:'POST',data:{cancel_at_period_end:true}})
  check('Cancel at period end',subscription.cancel_at_period_end===true)
  subscription=await stripe(`/subscriptions/${subscription.id}`,{method:'POST',data:{cancel_at_period_end:false}})
  check('Restart scheduled cancellation',subscription.cancel_at_period_end===false)

  const credit=await stripe(`/customers/${customer.id}/balance_transactions`,{method:'POST',data:{amount:-500,currency:'gbp',description:'ordered.food E2E credit'}})
  check('Customer credit',credit.amount===-500)

  const invoice=await stripe('/invoices',{method:'POST',data:{customer:customer.id,auto_advance:false,description:'ordered.food E2E invoice'}})
  await stripe(`/invoiceitems`,{method:'POST',data:{customer:customer.id,invoice:invoice.id,currency:'gbp',amount:1200,description:'ordered.food E2E charge'}})
  const finalInvoice=await stripe(`/invoices/${invoice.id}/finalize`,{method:'POST'})
  const paid=finalInvoice.status==='paid'?finalInvoice:await stripe(`/invoices/${invoice.id}/pay`,{method:'POST'})
  check('Successful invoice payment',paid.status==='paid')
  if(paid.charge){const refund=await stripe('/refunds',{method:'POST',data:{charge:paid.charge}});check('Refund',refund.status==='succeeded'||refund.status==='pending',refund.status)}

  const declineCustomer=await stripe('/customers',{method:'POST',data:{email:`ordered-food-decline-${Date.now()}@example.test`}});created.customers.push(declineCustomer.id)
  const declinePm=await stripe('/payment_methods',{method:'POST',data:{type:'card','card[token]':'tok_chargeDeclined'}})
  await stripe(`/payment_methods/${declinePm.id}/attach`,{method:'POST',data:{customer:declineCustomer.id}})
  await stripe(`/customers/${declineCustomer.id}`,{method:'POST',data:{'invoice_settings[default_payment_method]':declinePm.id}})
  let declined=false
  try{await stripe('/subscriptions',{method:'POST',data:{customer:declineCustomer.id,'items[0][price]':priceA.id,payment_behavior:'error_if_incomplete'}})}catch{declined=true}
  check('Failed-payment handling',declined)

  const checkout=await stripe('/checkout/sessions',{method:'POST',data:{mode:'subscription',customer:customer.id,'line_items[0][price]':priceA.id,'line_items[0][quantity]':1,success_url:'https://ordered.food/subscription?e2e=success',cancel_url:'https://ordered.food/subscription?e2e=cancel'}})
  check('Checkout Session',Boolean(checkout.url))

  try{const portal=await stripe('/billing_portal/sessions',{method:'POST',data:{customer:customer.id,return_url:'https://ordered.food/subscription'}});check('Billing Portal',Boolean(portal.url))}catch(error){throw new Error(`Billing Portal failed. Configure the Stripe test-mode customer portal before enabling this gate. ${error.message}`)}

  await stripe(`/subscriptions/${subscription.id}`,{method:'DELETE'})
  console.log(JSON.stringify({passed:true,checks},null,2))
}catch(error){console.error(error);process.exitCode=1}finally{await cleanup()}
