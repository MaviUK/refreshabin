import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers})
  if(request.method!=='POST')return reply({error:'Method not allowed.'},405)
  const url=Deno.env.get('SUPABASE_URL'),publishable=Deno.env.get('SUPABASE_ANON_KEY'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),stripeKey=Deno.env.get('STRIPE_SECRET_KEY')
  const authorization=request.headers.get('Authorization')
  if(!url||!publishable||!serviceKey||!stripeKey||!authorization)return reply({error:'Refund service is not configured.'},500)
  let body:{order_id?:string;amount_pence?:number;reason?:string}
  try{body=await request.json()}catch{return reply({error:'Invalid request body.'},400)}
  const amountPence=Number(body.amount_pence)
  if(!body.order_id||!Number.isInteger(amountPence)||amountPence<=0||!body.reason?.trim())return reply({error:'Order, amount and reason are required.'},400)
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
  const {data:reservation,error:reserveError}=await userClient.rpc('reserve_platform_refund',{p_order_id:body.order_id,p_amount_pence:amountPence,p_reason:body.reason.trim()})
  if(reserveError)return reply({error:reserveError.message},reserveError.code==='42501'?403:400)
  const reserved=reservation as {refund_request_id:string;payment_intent_id:string}
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
  try{
    const stripe=new Stripe(stripeKey)
    const refund=await stripe.refunds.create({payment_intent:reserved.payment_intent_id,amount:amountPence,metadata:{order_id:body.order_id,refund_request_id:reserved.refund_request_id}},{idempotencyKey:`ordered-refund-${reserved.refund_request_id}`})
    const {error}=await service.rpc('complete_platform_refund',{p_refund_request_id:reserved.refund_request_id,p_stripe_refund_id:refund.id,p_succeeded:refund.status==='succeeded'||refund.status==='pending',p_failure_message:refund.failure_reason??null})
    if(error)throw error
    return reply({refund_id:refund.id,status:refund.status})
  }catch(error){
    const message=error instanceof Error?error.message:'Stripe rejected the refund.'
    await service.rpc('complete_platform_refund',{p_refund_request_id:reserved.refund_request_id,p_stripe_refund_id:null,p_succeeded:false,p_failure_message:message.slice(0,500)})
    console.error('Refund failed',reserved.refund_request_id,error)
    return reply({error:message},400)
  }
})
