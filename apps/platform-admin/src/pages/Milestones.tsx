import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, hasAdminPermission } from '../types'
import { useAdmin } from '../components/AdminLayout'
import './Milestones.css'

type Summary={birthday_adoption:number;milestone_adoption:number;rewards_issued:number;redemption_rate:number;open_fraud_flags:number;revenue_generated_pence:number;campaign_cost_pence:number}
type RestaurantRow={restaurant_id:string;restaurant_name:string;birthday_enabled:boolean;birthday_disabled_by_platform:boolean;milestones_enabled:number;rewards_issued:number;redemptions:number;revenue_generated_pence:number;campaign_cost_pence:number}
type FraudFlag={id:string;restaurant_id:string;restaurant_name:string;customer_user_id:string|null;reward_issuance_id:string|null;source_type:string;flag_type:string;severity:string;status:string;details:Record<string,unknown>;created_at:string}
type Dashboard={summary:Summary;restaurants:RestaurantRow[];fraud_flags:FraudFlag[]}

const text=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase())
const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'})

export default function Milestones(){
 const{admin}=useAdmin()
 const[dash,setDash]=useState<Dashboard|null>(null)
 const[loading,setLoading]=useState(true)
 const[error,setError]=useState('')
 const[busy,setBusy]=useState('')
 const canDisable=hasAdminPermission(admin,'moderation:manage')
 const canReview=hasAdminPermission(admin,'moderation:manage')

 async function load(){setLoading(true);setError('');const{data,error:rpcError}=await supabase.rpc('get_platform_milestone_dashboard');if(rpcError)setError(rpcError.message);else setDash(data as Dashboard);setLoading(false)}
 useEffect(()=>{void load()},[])

 async function toggleBirthday(row:RestaurantRow){const disabling=!row.birthday_disabled_by_platform;if(disabling&&!row.birthday_enabled)return;const reason=disabling?window.prompt('Reason for disabling this birthday programme?','Suspected birthday reward abuse'):null;if(disabling&&!reason)return;setBusy(row.restaurant_id);const{error:rpcError}=await supabase.rpc('platform_set_birthday_program_disabled',{p_restaurant_id:row.restaurant_id,p_disabled:disabling,p_reason:reason});if(rpcError)setError(rpcError.message);else await load();setBusy('')}
 async function review(flag:FraudFlag,status:'confirmed'|'dismissed'){const note=window.prompt(`Optional note for ${status} decision:`,'');setBusy(flag.id);const{error:rpcError}=await supabase.rpc('platform_review_reward_fraud_flag',{p_flag_id:flag.id,p_status:status,p_note:note||''});if(rpcError)setError(rpcError.message);else await load();setBusy('')}

 if(loading)return <section className="admin-page"><div className="milestone-loading">Loading birthday and milestone intelligence…</div></section>
 const s=dash?.summary||{birthday_adoption:0,milestone_adoption:0,rewards_issued:0,redemption_rate:0,open_fraud_flags:0,revenue_generated_pence:0,campaign_cost_pence:0}
 const roi=s.campaign_cost_pence>0?((s.revenue_generated_pence-s.campaign_cost_pence)/s.campaign_cost_pence)*100:null

 return <section className="admin-page milestones-page">
  <header className="page-heading"><div><span className="admin-kicker">Retention & trust</span><h1>Birthdays & milestones</h1><p>Track programme adoption, reward economics, repeat visits and abuse signals across ordered.food.</p></div><button type="button" className="secondary-button" onClick={()=>void load()}>↻ Refresh</button></header>
  {error&&<div className="admin-alert error" role="alert">{error}</div>}

  <section className="milestone-metrics">
   <Metric label="Birthday adoption" value={String(s.birthday_adoption)} detail="Restaurants enabled" tone="pink"/>
   <Metric label="Milestone adoption" value={String(s.milestone_adoption)} detail="Restaurants with milestones" tone="blue"/>
   <Metric label="Rewards issued" value={String(s.rewards_issued)} detail="Birthday + milestone" tone="green"/>
   <Metric label="Redemption rate" value={`${Number(s.redemption_rate).toFixed(1)}%`} detail="Reward engagement" tone="amber"/>
   <Metric label="Revenue generated" value={formatMoney(s.revenue_generated_pence)} detail="Attributed repeat visits" tone="green"/>
   <Metric label="Campaign cost" value={formatMoney(s.campaign_cost_pence)} detail={roi===null?'No reward spend yet':`${roi.toFixed(1)}% platform ROI`} tone="amber"/>
   <Metric label="Open risk flags" value={String(s.open_fraud_flags)} detail="Needs review" tone={s.open_fraud_flags>0?'red':'blue'}/>
  </section>

  <section className="admin-panel milestone-panel">
   <div className="panel-heading"><div><span className="admin-kicker">Restaurant comparison</span><h2>Campaign performance</h2><p>Birthday status, milestone adoption, reward usage and attributed value.</p></div><span className="milestone-count">{dash?.restaurants.length??0} restaurants</span></div>
   {dash?.restaurants.length?<div className="milestone-programmes">{dash.restaurants.map(row=>{
    const redemption=row.rewards_issued>0?Math.round((row.redemptions/row.rewards_issued)*100):0
    const status=row.birthday_disabled_by_platform?'disabled':row.birthday_enabled?'enabled':'paused'
    return <article key={row.restaurant_id} className="milestone-programme-card">
     <div className="milestone-programme-head"><div><strong>{row.restaurant_name}</strong><span className={`milestone-status ${status}`}>{row.birthday_disabled_by_platform?'Birthday disabled':row.birthday_enabled?'Birthday enabled':'Birthday paused'}</span></div><div className="milestone-value"><small>Attributed revenue</small><strong>{formatMoney(row.revenue_generated_pence)}</strong></div></div>
     <div className="milestone-facts"><span><small>Milestones</small><strong>{row.milestones_enabled}</strong></span><span><small>Issued</small><strong>{row.rewards_issued}</strong></span><span><small>Redeemed</small><strong>{row.redemptions}</strong></span><span><small>Reward cost</small><strong>{formatMoney(row.campaign_cost_pence)}</strong></span></div>
     <div className="milestone-progress"><div><span>Reward redemption</span><strong>{redemption}%</strong></div><div className="milestone-progress-track"><span style={{width:`${Math.min(redemption,100)}%`}}/></div></div>
     <div className="milestone-programme-foot"><span>{row.milestones_enabled>0?`${row.milestones_enabled} active milestone${row.milestones_enabled===1?'':'s'}`:'No active milestones'}</span>{canDisable?<button type="button" className={row.birthday_disabled_by_platform?'secondary-button milestone-action':'danger-button ghost milestone-action'} disabled={busy===row.restaurant_id||(!row.birthday_enabled&&!row.birthday_disabled_by_platform)} onClick={()=>void toggleBirthday(row)}>{row.birthday_disabled_by_platform?'Re-enable birthday':row.birthday_enabled?'Disable birthday':'Restaurant paused'}</button>:<small>View only</small>}</div>
    </article>
   })}</div>:<div className="panel-empty"><strong>No birthday or milestone programmes yet</strong><span>Restaurant campaign performance will appear here once programmes are configured.</span></div>}
  </section>

  <section className="admin-panel milestone-panel">
   <div className="panel-heading"><div><span className="admin-kicker">Fraud monitoring</span><h2>Birthday and reward risk signals</h2><p>DOB values are never exposed here. Only behavioural risk signals are shown.</p></div><span className={`milestone-risk-count ${s.open_fraud_flags>0?'active':''}`}>{s.open_fraud_flags} open</span></div>
   {dash?.fraud_flags.length?<div className="milestone-risk-list">{dash.fraud_flags.map(flag=><article key={flag.id}><div className={`milestone-risk-severity ${flag.severity}`}/><div className="milestone-risk-copy"><strong>{flag.restaurant_name}</strong><span>{text(flag.flag_type)}</span><small>{text(flag.source_type)} · {date.format(new Date(flag.created_at))}</small></div><div className="milestone-risk-meta"><span className={`milestone-status risk-${flag.severity}`}>{text(flag.severity)}</span><span className="milestone-status neutral">{text(flag.status)}</span></div><div className="milestone-risk-actions">{flag.status==='open'&&canReview?<><button type="button" className="secondary-button milestone-action" disabled={busy===flag.id} onClick={()=>void review(flag,'confirmed')}>Confirm</button><button type="button" className="secondary-button milestone-action" disabled={busy===flag.id} onClick={()=>void review(flag,'dismissed')}>Dismiss</button></>:<small>{flag.status==='open'?'View only':'Reviewed'}</small>}</div></article>)}</div>:<div className="panel-empty"><strong>No suspicious birthday or milestone activity</strong><span>There are currently no reward risk signals requiring review.</span></div>}
  </section>
 </section>
}

function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:string}){return <article className="metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>}
