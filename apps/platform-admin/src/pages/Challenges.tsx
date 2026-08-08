import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, hasAdminPermission } from '../types'
import { useAdmin } from '../components/AdminLayout'
import './Challenges.css'

type Summary={restaurant_adoption:number;active_restaurants:number;participants:number;completions:number;completion_percent:number;reward_cost_pence:number;revenue_generated_pence:number;open_fraud_flags:number}
type TypeRow={condition_type:string;challenges:number;completions:number}
type RestaurantRow={restaurant_id:string;restaurant_name:string;challenges:number;participants:number;completions:number;reward_cost_pence:number;revenue_generated_pence:number}
type FraudFlag={id:string;challenge_id:string|null;restaurant_id:string;restaurant_name:string;customer_user_id:string|null;order_id:string|null;flag_type:string;severity:string;status:string;details:Record<string,unknown>;created_at:string}
type Dashboard={summary:Summary;challenge_types:TypeRow[];restaurants:RestaurantRow[];fraud_flags:FraudFlag[]}

const text=(v:string)=>v.replaceAll('_',' ').replace(/\b\w/g,l=>l.toUpperCase())
const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'})

export default function Challenges(){
 const{admin}=useAdmin()
 const[dash,setDash]=useState<Dashboard|null>(null)
 const[loading,setLoading]=useState(true)
 const[error,setError]=useState('')
 const[busy,setBusy]=useState('')
 const canManage=hasAdminPermission(admin,'restaurants:manage')

 async function load(){setLoading(true);setError('');const{data,error:rpcError}=await supabase.rpc('get_platform_challenge_dashboard');if(rpcError)setError(rpcError.message);else setDash(data as Dashboard);setLoading(false)}
 useEffect(()=>{void load()},[])

 async function review(flag:FraudFlag,status:'reviewed'|'dismissed'|'confirmed'){const note=window.prompt(`Optional note for ${status}:`,'');setBusy(flag.id);const{error:e}=await supabase.rpc('platform_review_challenge_fraud_flag',{p_flag_id:flag.id,p_status:status,p_note:note||''});if(e)setError(e.message);else await load();setBusy('')}
 async function disableChallenge(challengeId:string){const reason=window.prompt('Reason for disabling this challenge?','Challenge abuse investigation');if(!reason)return;setBusy(challengeId);const{error:e}=await supabase.rpc('platform_set_challenge_disabled',{p_challenge_id:challengeId,p_disabled:true,p_reason:reason});if(e)setError(e.message);else await load();setBusy('')}

 if(loading)return <section className="admin-page"><div className="challenge-loading">Loading challenge intelligence…</div></section>
 const s=dash?.summary||{restaurant_adoption:0,active_restaurants:0,participants:0,completions:0,completion_percent:0,reward_cost_pence:0,revenue_generated_pence:0,open_fraud_flags:0}
 const roi=s.reward_cost_pence?((s.revenue_generated_pence-s.reward_cost_pence)/s.reward_cost_pence)*100:s.revenue_generated_pence?100:0

 return <section className="admin-page challenges-page">
  <header className="page-heading"><div><span className="admin-kicker">Gamification & retention</span><h1>Challenges</h1><p>Platform adoption, engagement, reward economics, successful mission types and fraud signals.</p></div><button type="button" className="secondary-button" onClick={()=>void load()}>↻ Refresh</button></header>
  {error&&<div className="admin-alert error" role="alert">{error}</div>}

  <section className="challenge-metrics">
   <Metric label="Restaurant adoption" value={String(s.restaurant_adoption)} detail={`${s.active_restaurants} currently active`} tone="blue"/>
   <Metric label="Participants" value={String(s.participants)} detail="Unique challenge customers" tone="pink"/>
   <Metric label="Completions" value={String(s.completions)} detail={`${Number(s.completion_percent).toFixed(1)}% completion`} tone="green"/>
   <Metric label="Revenue generated" value={formatMoney(s.revenue_generated_pence)} detail="Tracked post-reward revenue" tone="green"/>
   <Metric label="Reward cost" value={formatMoney(s.reward_cost_pence)} detail="Challenge campaign cost" tone="amber"/>
   <Metric label="ROI" value={`${roi.toFixed(1)}%`} detail="Revenue versus reward cost" tone={roi>=0?'green':'red'}/>
   <Metric label="Open fraud flags" value={String(s.open_fraud_flags)} detail="Needs investigation" tone={s.open_fraud_flags>0?'red':'blue'}/>
  </section>

  <ChallengeTypes rows={dash?.challenge_types??[]}/>

  <section className="admin-panel challenge-panel">
   <div className="panel-heading"><div><span className="admin-kicker">Restaurant comparison</span><h2>Challenge performance</h2><p>Compare participation, completions, revenue, reward cost and ROI.</p></div><span className="challenge-count">{dash?.restaurants.length??0} restaurants</span></div>
   {dash?.restaurants.length?<div className="challenge-restaurants">{dash.restaurants.map(row=><RestaurantCard key={row.restaurant_id} row={row}/>)}</div>:<div className="panel-empty"><strong>No restaurants have configured challenges</strong><span>Restaurant challenge performance will appear here once campaigns go live.</span></div>}
  </section>

  <section className="admin-panel challenge-panel">
   <div className="panel-heading"><div><span className="admin-kicker">Fraud monitoring</span><h2>Challenge risk signals</h2><p>Rewards are server-side and idempotent; these signals surface abnormal behaviour for review.</p></div><span className={`challenge-risk-count ${s.open_fraud_flags>0?'active':''}`}>{s.open_fraud_flags} open</span></div>
   {dash?.fraud_flags.length?<div className="challenge-risk-list">{dash.fraud_flags.map(flag=><article key={flag.id}><div className={`challenge-severity ${flag.severity}`}/><div className="challenge-risk-main"><strong>{flag.restaurant_name}</strong><span>{text(flag.flag_type)}</span><small>{date.format(new Date(flag.created_at))}</small></div><div className="challenge-risk-meta"><span className={`challenge-status risk-${flag.severity}`}>{text(flag.severity)}</span><span className="challenge-status neutral">{text(flag.status)}</span></div><div className="challenge-risk-details">{details(flag.details)}</div><div className="challenge-risk-actions">{flag.status==='open'&&canManage?<><button type="button" className="secondary-button challenge-action" disabled={busy===flag.id} onClick={()=>void review(flag,'reviewed')}>Review</button><button type="button" className="secondary-button challenge-action" disabled={busy===flag.id} onClick={()=>void review(flag,'dismissed')}>Dismiss</button><button type="button" className="secondary-button challenge-action" disabled={busy===flag.id} onClick={()=>void review(flag,'confirmed')}>Confirm</button>{flag.challenge_id&&<button type="button" className="danger-button ghost challenge-action" disabled={busy===flag.challenge_id} onClick={()=>void disableChallenge(flag.challenge_id!)}>Disable challenge</button>}</>:<small>{flag.status==='open'?'View only':'Reviewed'}</small>}</div></article>)}</div>:<div className="panel-empty"><strong>No challenge fraud signals</strong><span>There are currently no abnormal challenge events requiring review.</span></div>}
  </section>
 </section>
}

function Metric({label,value,detail,tone}:{label:string;value:string;detail:string;tone:string}){return <article className="metric"><span className={`metric-dot ${tone}`}/><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>}

function ChallengeTypes({rows}:{rows:TypeRow[]}){
 const maxCompletions=useMemo(()=>Math.max(...rows.map(row=>row.completions),1),[rows])
 return <section className="admin-panel challenge-panel"><div className="panel-heading"><div><span className="admin-kicker">Popularity</span><h2>Most successful challenge types</h2><p>Challenge formats ranked by completion activity.</p></div></div>{rows.length?<div className="challenge-type-grid">{rows.map((row,index)=>{const perCampaign=row.challenges?row.completions/row.challenges:0;return <article key={row.condition_type} className="challenge-type-card"><div className="challenge-type-rank">#{index+1}</div><div className="challenge-type-copy"><strong>{text(row.condition_type)}</strong><small>{row.challenges} configured campaign{row.challenges===1?'':'s'}</small></div><div className="challenge-type-value"><strong>{row.completions}</strong><small>completions</small></div><div className="challenge-type-track"><span style={{width:`${Math.max(4,(row.completions/maxCompletions)*100)}%`}}/></div><div className="challenge-type-foot"><span>{perCampaign.toFixed(1)} completions per campaign</span></div></article>})}</div>:<div className="panel-empty"><strong>No challenge campaigns yet</strong><span>Challenge type rankings will appear once campaigns start receiving completions.</span></div>}</section>
}

function RestaurantCard({row}:{row:RestaurantRow}){
 const roi=row.reward_cost_pence?((row.revenue_generated_pence-row.reward_cost_pence)/row.reward_cost_pence)*100:row.revenue_generated_pence?100:0
 const completionRate=row.participants?Math.min(100,(row.completions/row.participants)*100):0
 return <article className="challenge-restaurant-card"><div className="challenge-restaurant-head"><div><strong>{row.restaurant_name}</strong><small>{row.challenges} active/configured challenge{row.challenges===1?'':'s'}</small></div><span className={`challenge-roi ${roi>=0?'positive':'negative'}`}>{roi.toFixed(1)}% ROI</span></div><div className="challenge-restaurant-stats"><span><small>Participants</small><strong>{row.participants}</strong></span><span><small>Completions</small><strong>{row.completions}</strong></span><span><small>Revenue</small><strong>{formatMoney(row.revenue_generated_pence)}</strong></span><span><small>Reward cost</small><strong>{formatMoney(row.reward_cost_pence)}</strong></span></div><div className="challenge-progress-copy"><span>Participant completion</span><strong>{completionRate.toFixed(0)}%</strong></div><div className="challenge-progress"><span style={{width:`${completionRate}%`}}/></div></article>
}

function details(value:Record<string,unknown>){const items=Object.entries(value||{}).slice(0,3);if(!items.length)return <small>No additional details</small>;return <>{items.map(([key,val])=><span key={key}><small>{text(key)}</small><strong>{String(val)}</strong></span>)}</>}
