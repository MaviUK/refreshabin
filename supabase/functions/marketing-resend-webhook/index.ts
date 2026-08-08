import { createClient } from 'npm:@supabase/supabase-js@2'
import { Webhook } from 'npm:svix@1.76.1'

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405})
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('RESEND_WEBHOOK_SECRET')
  if(!url||!service||!secret)return new Response('Webhook not configured',{status:500})
  const raw=await req.text();let event:any
  try{event=new Webhook(secret).verify(raw,{'svix-id':req.headers.get('svix-id')||'','svix-timestamp':req.headers.get('svix-timestamp')||'','svix-signature':req.headers.get('svix-signature')||''})}catch{return new Response('Invalid webhook signature',{status:400})}
  const emailId=String(event?.data?.email_id||'')
  if(!emailId)return new Response('ok')
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const{error}=await db.rpc('marketing_record_resend_event',{p_provider_message_id:emailId,p_event_type:String(event.type||''),p_provider_event_id:req.headers.get('svix-id')||crypto.randomUUID(),p_event_at:event.created_at||new Date().toISOString(),p_metadata:event.data||{}})
  if(error)return new Response(error.message,{status:500})
  return new Response('ok',{status:200})
})
