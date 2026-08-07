import { createClient } from 'npm:@supabase/supabase-js@2'

const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]||c))
function isServiceRoleRequest(req:Request){const auth=req.headers.get('Authorization')||'';const token=auth.replace(/^Bearer\s+/i,'');const parts=token.split('.');if(parts.length!==3)return false;try{let payload=parts[1].replace(/-/g,'+').replace(/_/g,'/');payload=payload.padEnd(Math.ceil(payload.length/4)*4,'=');const claims=JSON.parse(atob(payload));return claims?.role==='service_role'}catch{return false}}
async function sendEmail(apiKey:string,from:string,to:string,subject:string,html:string){const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,html})});if(!response.ok)throw new Error(`Resend returned ${response.status}`)}
async function dispatchPush(url:string,secret:string|undefined,payload:unknown){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(secret?{'Authorization':`Bearer ${secret}`}:{})},body:JSON.stringify(payload)});if(!response.ok)throw new Error(`Push hook returned ${response.status}`)}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{'Content-Type':'application/json'}})
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),resend=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('RESEND_FROM_EMAIL')||'ordered.food <orders@ordered.food>',site=(Deno.env.get('SITE_URL')||'https://ordered.food').replace(/\/$/,''),pushUrl=Deno.env.get('MOBILE_PUSH_WEBHOOK_URL'),pushSecret=Deno.env.get('MOBILE_PUSH_WEBHOOK_SECRET')
  if(!url||!service||!resend)return new Response(JSON.stringify({error:'Birthday and milestone processor is not configured'}),{status:500,headers:{'Content-Type':'application/json'}})
  if(!isServiceRoleRequest(req))return new Response(JSON.stringify({error:'Service role authorization required'}),{status:401,headers:{'Content-Type':'application/json'}})
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const today=new Date().toISOString().slice(0,10)
  const [{data:birthday,error:birthdayError},{data:expiry,error:expiryError}]=await Promise.all([
    db.rpc('process_birthday_rewards',{p_run_date:today}),
    db.rpc('process_reward_expiry_and_reminders',{p_now:new Date().toISOString()}),
  ])
  if(birthdayError||expiryError)return new Response(JSON.stringify({error:(birthdayError||expiryError)?.message}),{status:500,headers:{'Content-Type':'application/json'}})
  const{data:rows,error}=await db.from('reward_notification_queue').select('id,reward_issuance_id,customer_user_id,event_type,subject,body,action_url,push_payload,push_status,attempts').in('status',['pending','failed']).lte('available_at',new Date().toISOString()).lt('attempts',5).order('created_at',{ascending:true}).limit(100)
  if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:{'Content-Type':'application/json'}})
  const results=[]
  for(const row of rows||[]){
    try{
      await db.from('reward_notification_queue').update({status:'processing',attempts:(row.attempts||0)+1,last_error:null,updated_at:new Date().toISOString()}).eq('id',row.id).in('status',['pending','failed'])
      const{data:userData,error:userError}=await db.auth.admin.getUserById(row.customer_user_id)
      if(userError||!userData.user?.email)throw userError||new Error('Customer email unavailable')
      const action=`${site}${row.action_url||'/account/milestones'}`
      const html=`<div style="font-family:Arial,sans-serif;background:#f5f1e8;padding:32px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px"><p style="font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#756d63">ordered.food rewards</p><h1 style="font-size:30px">${esc(row.subject)}</h1><p style="font-size:17px;line-height:1.6;color:#4b453e">${esc(row.body)}</p><a href="${esc(action)}" style="display:inline-block;margin-top:18px;background:#171615;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none">View rewards</a></div></div>`
      await sendEmail(resend,from,userData.user.email,row.subject,html)
      let pushStatus='skipped'
      if(pushUrl){try{await dispatchPush(pushUrl,pushSecret,{customer_user_id:row.customer_user_id,event_type:row.event_type,...(row.push_payload||{})});pushStatus='dispatched'}catch(pushError){pushStatus='failed';console.error('Push hook failed',pushError)}}
      await db.from('reward_notification_queue').update({status:'sent',push_status:pushStatus,sent_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()}).eq('id',row.id)
      results.push({id:row.id,status:'sent',push_status:pushStatus})
    }catch(caught){const message=caught instanceof Error?caught.message.slice(0,500):'Notification failed';const attempts=(row.attempts||0)+1;await db.from('reward_notification_queue').update({status:attempts>=5?'failed':'pending',last_error:message,available_at:new Date(Date.now()+60*60*1000).toISOString(),updated_at:new Date().toISOString()}).eq('id',row.id);results.push({id:row.id,status:'failed',error:message})}
  }
  return new Response(JSON.stringify({birthday,expiry,processed:results.length,results}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
})
