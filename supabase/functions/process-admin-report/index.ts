import { createClient } from 'npm:@supabase/supabase-js@2'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
const csvCell=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  const supabaseUrl=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),resendKey=Deno.env.get('RESEND_API_KEY')
  if(!supabaseUrl||!serviceKey||!resendKey) return json({error:'Report delivery is not configured'},500)
  const supabase=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
  const body=await req.json().catch(()=>({})) as {run_id?:string}
  let query=supabase.from('platform_report_runs').select('*').eq('status','queued').order('created_at').limit(1)
  if(body.run_id) query=query.eq('id',body.run_id)
  const {data:run,error:runError}=await query.maybeSingle()
  if(runError) return json({error:runError.message},500)
  if(!run) return json({processed:false})
  await supabase.from('platform_report_runs').update({status:'processing',started_at:new Date().toISOString()}).eq('id',run.id).eq('status','queued')
  try{
    const rows=await buildRows(supabase,run.report_type,run.period_from,run.period_to)
    const headers=rows.length?Object.keys(rows[0]):['message']
    const csv=[headers,...rows.map(row=>headers.map(key=>row[key]))].map(row=>row.map(csvCell).join(',')).join('\n')
    const fileName=`ordered-food-${run.report_type}-${run.period_from}-${run.period_to}.csv`
    const emailResponse=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${resendKey}`,'content-type':'application/json'},body:JSON.stringify({from:Deno.env.get('REPORT_FROM_EMAIL')||'ordered.food <reports@ordered.food>',to:run.recipients,subject:`ordered.food ${run.report_type.replaceAll('_',' ')} report`,html:`<h1>ordered.food report</h1><p>${run.period_from} to ${run.period_to}</p><p>${rows.length} rows are attached.</p>`,attachments:[{filename:fileName,content:btoa(unescape(encodeURIComponent(csv)))}]})})
    if(!emailResponse.ok) throw new Error(`Resend failed: ${await emailResponse.text()}`)
    await supabase.from('platform_report_runs').update({status:'completed',row_count:rows.length,file_name:fileName,completed_at:new Date().toISOString()}).eq('id',run.id)
    if(run.schedule_id){
      const {data:s}=await supabase.from('platform_report_schedules').select('*').eq('id',run.schedule_id).single()
      if(s) await supabase.from('platform_report_schedules').update({last_run_at:new Date().toISOString(),next_run_at:null,updated_at:new Date().toISOString()}).eq('id',s.id)
    }
    return json({processed:true,run_id:run.id,row_count:rows.length})
  }catch(error){
    const message=error instanceof Error?error.message:'Report delivery failed'
    await supabase.from('platform_report_runs').update({status:'failed',error_message:message,completed_at:new Date().toISOString()}).eq('id',run.id)
    return json({error:message},500)
  }
})

async function buildRows(supabase:any,type:string,from:string,to:string):Promise<Record<string,unknown>[]>{
  if(type==='financial_summary'){
    const {data,error}=await supabase.rpc('get_restaurant_financial_overview',{p_from:from,p_to:to,p_restaurant_id:null}); if(error)throw error; return data?.rows||[]
  }
  if(type==='order_operations'){
    const {data,error}=await supabase.from('orders').select('order_number,order_status,payment_status,fulfilment_method,total_pence,created_at,restaurants(name)').gte('created_at',`${from}T00:00:00Z`).lt('created_at',`${to}T23:59:59Z`).order('created_at'); if(error)throw error; return data||[]
  }
  if(type==='support_sla'){
    const {data,error}=await supabase.from('platform_support_cases').select('case_number,subject,status,priority,response_due_at,resolution_due_at,created_at').gte('created_at',`${from}T00:00:00Z`).lt('created_at',`${to}T23:59:59Z`).order('created_at'); if(error)throw error; return data||[]
  }
  if(type==='risk_signals'){
    const {data,error}=await supabase.from('platform_risk_reviews').select('signal_type,severity,status,subject_label,created_at,resolved_at').gte('created_at',`${from}T00:00:00Z`).lt('created_at',`${to}T23:59:59Z`).order('created_at'); if(error)throw error; return data||[]
  }
  const {data,error}=await supabase.rpc('get_platform_analytics',{p_days:Math.max(1,Math.ceil((new Date(to).getTime()-new Date(from).getTime())/86400000)+1)}); if(error)throw error; return data?.restaurant_performance||[]
}