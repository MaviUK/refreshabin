import { createClient } from 'npm:@supabase/supabase-js@2'

function isServiceRoleRequest(req:Request){const auth=req.headers.get('Authorization')||'';const token=auth.replace(/^Bearer\s+/i,'');const parts=token.split('.');if(parts.length!==3)return false;try{let payload=parts[1].replace(/-/g,'+').replace(/_/g,'/');payload=payload.padEnd(Math.ceil(payload.length/4)*4,'=');const claims=JSON.parse(atob(payload));return claims?.role==='service_role'}catch{return false}}
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c]||c))
const replaceVars=(value:string|null|undefined,vars:Record<string,unknown>)=>(value||'').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_,key)=>String(vars[key]??''))
async function sha256(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('')}
async function sendEmail(apiKey:string,from:string,to:string,subject:string,html:string,idempotencyKey:string){const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from,to:[to],subject,html})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`Resend returned ${response.status}: ${String(body?.message||'send failed')}`);return String(body?.id||'')}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{'Content-Type':'application/json'}})
  if(!isServiceRoleRequest(req))return new Response(JSON.stringify({error:'Service role authorization required'}),{status:401,headers:{'Content-Type':'application/json'}})
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),resend=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RESEND_FROM_EMAIL')||'ordered.food <orders@ordered.food>',site=(Deno.env.get('SITE_URL')||'https://ordered.food').replace(/\/$/,'')
  if(!url||!service||!resend)return new Response(JSON.stringify({error:'Marketing processor is not configured'}),{status:500,headers:{'Content-Type':'application/json'}})
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const results:{stage:string;result?:unknown;error?:string}[]=[]
  for(const [stage,rpc,args] of [['campaigns','marketing_process_due_campaigns',{p_limit:25}],['triggers','marketing_process_automation_triggers',{p_limit:1000}]] as const){const{data,error}=await db.rpc(rpc,args);if(error)results.push({stage,error:error.message});else results.push({stage,result:data})}
  for(let i=0;i<8;i++){const{data,error}=await db.rpc('marketing_process_automation_steps',{p_limit:250});if(error){results.push({stage:'automation_steps',error:error.message});break}results.push({stage:'automation_steps',result:data});if(Number(data?.processed_steps||0)===0)break}
  const{data:deliveries,error:claimError}=await db.rpc('marketing_claim_deliveries',{p_limit:100})
  if(claimError)return new Response(JSON.stringify({error:claimError.message,results}),{status:500,headers:{'Content-Type':'application/json'}})
  const sent=[]
  for(const row of deliveries||[]){try{
    const vars={...(row.metadata||{}),customer_id:row.customer_user_id}
    if(row.channel==='in_app'){
      const title=replaceVars(row.subject||'A message from your restaurant',vars),body=replaceVars(row.text_content||row.preview_text||'Open ordered.food to see your latest offer.',vars)
      const{error}=await db.from('customer_notifications').insert({customer_user_id:row.customer_user_id,restaurant_id:row.restaurant_id,notification_type:'marketing_campaign',title,body,action_url:row.cta_url||'/account',metadata:{marketing_delivery_id:row.id,campaign_id:row.campaign_id,automation_id:row.automation_id},dedupe_key:`marketing:${row.id}`})
      if(error&&error.code!=='23505')throw error
      await db.rpc('marketing_complete_delivery',{p_delivery_id:row.id,p_provider_message_id:`inapp:${row.id}`,p_token_hash:null})
      sent.push({id:row.id,status:'delivered'});continue
    }
    if(row.channel!=='email')throw new Error('Push delivery is reserved for future push provider support')
    if(!row.recipient_email)throw new Error('Recipient email unavailable')
    const rawToken=String(row.id);const tokenHash=await sha256(rawToken);const unsubscribe=`${site}/marketing/unsubscribe?token=${encodeURIComponent(rawToken)}`
    const registration=await db.rpc('marketing_register_unsubscribe_token',{p_delivery_id:row.id,p_token_hash:tokenHash});if(registration.error)throw registration.error
    const subject=replaceVars(row.subject||'A message from your restaurant',vars),content=replaceVars(row.html_content||`<p>${esc(row.text_content||row.preview_text||'')}</p>`,vars),cta=row.cta_url?`<p><a href="${esc(row.cta_url)}" style="display:inline-block;background:#171615;color:white;text-decoration:none;padding:12px 18px;border-radius:999px">${esc(row.cta_label||'View offer')}</a></p>`:''
    const html=`<div style="font-family:Arial,sans-serif;background:#f5f1e8;padding:32px"><div style="max-width:620px;margin:auto;background:#fff;border-radius:20px;padding:32px">${row.image_url?`<img src="${esc(row.image_url)}" alt="" style="max-width:100%;border-radius:14px">`:''}${content}${cta}<hr style="border:0;border-top:1px solid #e7e1d8;margin:28px 0"><p style="font-size:12px;color:#756d63">You received this because your marketing preferences allow messages from this restaurant. <a href="${esc(unsubscribe)}">Unsubscribe</a>.</p></div></div>`
    const providerId=await sendEmail(resend,from,row.recipient_email,subject,html,`marketing/${row.id}`)
    await db.rpc('marketing_complete_delivery',{p_delivery_id:row.id,p_provider_message_id:providerId,p_token_hash:null})
    sent.push({id:row.id,status:'sent',providerId})
  }catch(caught){const message=caught instanceof Error?caught.message:'Delivery failed';await db.rpc('marketing_fail_delivery',{p_delivery_id:row.id,p_error:message});sent.push({id:row.id,status:'failed',error:message})}}
  return new Response(JSON.stringify({claimed:(deliveries||[]).length,sent,results}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
})
