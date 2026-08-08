import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:svix@1.76.1'

const MAX_BODY_BYTES=1024*1024

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405})
  const declaredLength=Number(req.headers.get('content-length')||'0')
  if(Number.isFinite(declaredLength)&&declaredLength>MAX_BODY_BYTES)return new Response('Request body is too large',{status:413})
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('RESEND_WEBHOOK_SECRET')
  if(!url||!service||!secret)return new Response('Webhook not configured',{status:500})
  const raw=await req.text()
  if(new TextEncoder().encode(raw).byteLength>MAX_BODY_BYTES)return new Response('Request body is too large',{status:413})
  const svixId=req.headers.get('svix-id')||'',svixTimestamp=req.headers.get('svix-timestamp')||'',svixSignature=req.headers.get('svix-signature')||''
  if(!svixId||!svixTimestamp||!svixSignature)return new Response('Missing webhook signature',{status:400})
  let event:any
  try{event=new Webhook(secret).verify(raw,{'svix-id':svixId,'svix-timestamp':svixTimestamp,'svix-signature':svixSignature})}catch{return new Response('Invalid webhook signature',{status:400})}
  const emailId=String(event?.data?.email_id||'')
  if(!emailId)return new Response('ok')
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const{error}=await db.rpc('marketing_record_resend_event',{p_provider_message_id:emailId,p_event_type:String(event.type||''),p_provider_event_id:svixId,p_event_at:event.created_at||new Date().toISOString(),p_metadata:event.data||{}})
  if(error)return new Response('Webhook processing failed',{status:500})
  return new Response('ok',{status:200})
})
