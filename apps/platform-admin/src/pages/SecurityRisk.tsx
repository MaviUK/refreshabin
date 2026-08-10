import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAdmin } from '../components/AdminLayout'
import { supabase } from '../lib/supabase'
import { formatDate, formatMoney, hasAdminPermission } from '../types'

type Risk = {
  id: string | null
  subject_type: string
  subject_id: string | null
  subject_key: string | null
  risk_type: string
  severity: 'low' | 'normal' | 'high' | 'urgent'
  status: 'open' | 'in_review' | 'resolved' | 'dismissed'
  summary: string
  details: Record<string, unknown>
  assigned_to: string | null
  created_at: string
  updated_at: string
}

type AdminEvent = { id:number; action:string; actor_name:string; target_type:string; target_id:string|null; created_at:string }
type Snapshot = { metrics:{open:number;urgent:number;in_review:number;admin_events_24h:number}; risks:Risk[]; recent_admin_events:AdminEvent[] }

export default function SecurityRisk(){
  const { admin }=useAdmin()
  const canManage=hasAdminPermission(admin,'moderation:manage')
  const [status,setStatus]=useState('open'),[severity,setSeverity]=useState('all'),[search,setSearch]=useState('')
  const [data,setData]=useState<Snapshot|null>(null),[selected,setSelected]=useState<Risk|null>(null)
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[resolution,setResolution]=useState('')

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    const {data:result,error:e}=await supabase.rpc('get_platform_risk_dashboard',{p_status:status,p_severity:severity,p_search:search.trim()||null})
    if(e)setError(e.message);else{const next=result as Snapshot;setData(next);setSelected(current=>next.risks.find(r=>r.id===current?.id&&r.risk_type===current.risk_type&&r.subject_key===current.subject_key)??next.risks[0]??null)}
    setLoading(false)
  },[search,severity,status])

  useEffect(()=>{const timer=window.setTimeout(()=>void load(),search?250:0);return()=>window.clearTimeout(timer)},[load,search])

  async function persistGenerated(risk:Risk){
    if(risk.id)return risk.id
    const {data:id,error:e}=await supabase.rpc('create_platform_risk_review',{p_subject_type:risk.subject_type,p_subject_id:risk.subject_id,p_subject_key:risk.subject_key,p_risk_type:risk.risk_type,p_severity:risk.severity,p_summary:risk.summary,p_details:risk.details})
    if(e)throw e
    return id as string
  }

  async function act(event:FormEvent,action:'claim'|'resolve'|'dismiss'){
    event.preventDefault();if(!selected||!canManage)return
    if(action!=='claim'&&resolution.trim().length<5){setError('Enter a resolution of at least 5 characters.');return}
    setSaving(true);setError('');setSuccess('')
    try{
      const id=await persistGenerated(selected)
      const {error:e}=await supabase.rpc('manage_platform_risk_review',{p_review_id:id,p_action:action,p_resolution:action==='claim'?null:resolution.trim()})
      if(e)throw e
      setResolution('');setSuccess(action==='claim'?'Risk review claimed.':'Risk review closed and audited.');await load()
    }catch(e){setError(e instanceof Error?e.message:'Risk action failed.')}
    setSaving(false)
  }

  return <div className="admin-page security-risk-page">
    <header className="page-heading"><div><span className="admin-kicker">Security & fraud operations</span><h1>Security and risk</h1><p>Investigate payment abuse, unusual refund behaviour and sensitive administrator activity.</p></div><button className="secondary-button" type="button" disabled={loading} onClick={()=>void load()}>↻ Refresh</button></header>
    {error&&<div className="admin-alert error" role="alert">{error}</div>}{success&&<div className="admin-alert success" role="status">{success}</div>}
    <section className="support-metrics"><article><small>Open risks</small><strong>{data?.metrics.open??0}</strong></article><article><small>Urgent</small><strong>{data?.metrics.urgent??0}</strong></article><article><small>In review</small><strong>{data?.metrics.in_review??0}</strong></article><article><small>Sensitive actions · 24h</small><strong>{data?.metrics.admin_events_24h??0}</strong></article></section>
    <section className="support-toolbar"><input type="search" placeholder="Customer, restaurant, risk type…" value={search} onChange={e=>setSearch(e.target.value)}/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select><select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">All severities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></section>
    <div className="support-workspace"><section className="support-list"><div className="list-heading"><strong>{loading?'Loading…':`${data?.risks.length??0} risk signals`}</strong></div>{!loading&&!data?.risks.length&&<div className="panel-empty"><strong>No risk signals</strong><span>No records match the current filters.</span></div>}{data?.risks.map((risk,index)=><button key={risk.id??`${risk.risk_type}-${risk.subject_key}-${index}`} className={selected===risk?'active':''} onClick={()=>{setSelected(risk);setResolution('');setSuccess('')}}><span><strong>{risk.summary}</strong><small>{risk.subject_key||humanise(risk.subject_type)} · {humanise(risk.risk_type)}</small></span><span><small className={`case-priority ${risk.severity}`}>{risk.severity}</small><small className={`case-status ${risk.status}`}>{humanise(risk.status)}</small></span><time>{formatDate(risk.updated_at)}</time></button>)}</section>
    <section className="support-detail">{!selected?<div className="panel-empty">Select a risk signal to investigate it.</div>:<><header><div><span className="admin-kicker">{humanise(selected.subject_type)} risk</span><h2>{selected.summary}</h2><p>{selected.subject_key||'No customer-facing identifier is available.'}</p></div><span className={`case-priority ${selected.severity}`}>{selected.severity}</span></header><div className="support-facts"><article><small>Risk type</small><strong>{humanise(selected.risk_type)}</strong></article><article><small>Status</small><strong>{humanise(selected.status)}</strong></article><article><small>Detected</small><strong>{formatDate(selected.created_at)}</strong></article></div><RiskDetails details={selected.details}/>{canManage&&['open','in_review'].includes(selected.status)&&<form className="support-note" onSubmit={e=>void act(e,selected.status==='open'?'claim':'resolve')}><label>Investigation resolution<textarea rows={4} minLength={5} maxLength={1000} value={resolution} onChange={e=>setResolution(e.target.value)} placeholder={selected.status==='open'?'Claim this signal first, or enter a resolution to dismiss it…':'Explain what was checked and the outcome…'}/></label><div className="confirmation-buttons">{selected.status==='open'&&<button className="secondary-button" type="button" disabled={saving} onClick={e=>void act(e as unknown as FormEvent,'claim')}>Claim review</button>}<button className="secondary-button" type="button" disabled={saving||resolution.trim().length<5} onClick={e=>void act(e as unknown as FormEvent,'dismiss')}>Dismiss</button><button className="admin-primary-button" disabled={saving||selected.status==='open'||resolution.trim().length<5}>{saving?'Saving…':'Resolve risk'}</button></div></form>}</>}</section></div>
    <section className="admin-panel"><div className="panel-heading"><div><h2>Recent administrator activity</h2><p>Latest platform audit events for access review.</p></div></div><div className="order-timeline">{data?.recent_admin_events.map(event=><article key={event.id}><span className="timeline-dot"/><div><strong>{humanise(event.action)}</strong><small>{event.actor_name} · {humanise(event.target_type)}</small></div><time>{formatDate(event.created_at)}</time></article>)}</div></section>
  </div>
}

function RiskDetails({details}:{details:Record<string,unknown>}){
  const rows=Object.entries(details)
  return <section className="order-detail-section"><h3>Signal evidence</h3><div className="operation-grid">{rows.map(([key,value])=><article key={key}><small>{humanise(key)}</small><strong>{formatValue(key,value)}</strong></article>)}</div></section>
}
function formatValue(key:string,value:unknown){if(typeof value==='number'&&key.endsWith('_pence'))return formatMoney(value);if(typeof value==='string'&&key.endsWith('_at'))return formatDate(value);return String(value??'—')}
function humanise(value:string){return value.replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase())}
