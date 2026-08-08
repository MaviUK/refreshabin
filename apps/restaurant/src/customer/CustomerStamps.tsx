import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './CustomerStamps.css'

type StampCard = { card_id:string; restaurant_name:string; restaurant_slug:string; program_name:string; description?:string|null; current_stamps:number; stamps_required:number; remaining_stamps:number; completed_cycles:number; reward_name:string; expires_at?:string|null; is_active:boolean; last_stamp_at?:string|null }
type StampEvent = { id:string; program_name:string; restaurant_name:string; event_type:string; stamps_delta:number; note?:string|null; created_at:string }
type Wallet = { cards:StampCard[]; recent_events:StampEvent[] }
const date = new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'})

export default function CustomerStamps(){
  const navigate=useNavigate(); const[wallet,setWallet]=useState<Wallet|null>(null); const[loading,setLoading]=useState(true); const[error,setError]=useState('')
  useEffect(()=>{let active=true; async function load(){const{data:session}=await supabase.auth.getSession(); if(!session.session){navigate('/account/login',{replace:true,state:{from:'/account/stamps'}});return} const{data,error:loadError}=await supabase.rpc('get_customer_stamp_wallet'); if(!active)return; if(loadError)setError(loadError.message); else setWallet(data as Wallet); setLoading(false)} void load(); return()=>{active=false}},[navigate])
  if(loading)return <main className="customer-stamps-state">Loading stamp cards…</main>
  const cards=wallet?.cards||[],events=wallet?.recent_events||[]
  return <main className="customer-stamps-page"><header><Link to="/account">← Account</Link><strong>ordered.food</strong><Link to="/restaurants">Find food</Link></header>
    <section className="customer-stamps-hero"><span>Your loyalty</span><h1>Digital stamp cards</h1><p>Every qualifying completed order moves you closer to a reward.</p></section>
    {error&&<p className="customer-stamps-error">{error}</p>}
    <section className="customer-stamps-grid">{cards.length?cards.map(card=><article key={card.card_id} className={!card.is_active?'inactive':''}><div className="customer-stamps-card-head"><div><span>{card.restaurant_name}</span><h2>{card.program_name}</h2></div><strong>{card.current_stamps}/{card.stamps_required}</strong></div><p>{card.description||`Complete the card to receive ${card.reward_name}.`}</p><div className="customer-stamps-dots">{Array.from({length:card.stamps_required},(_,index)=><i key={index} className={index<card.current_stamps?'filled':''}>{index<card.current_stamps?'✓':index+1}</i>)}</div><div className="customer-stamps-progress"><span style={{width:`${Math.min(100,(card.current_stamps/card.stamps_required)*100)}%`}}/></div><div className="customer-stamps-footer"><div><small>Next reward</small><strong>{card.reward_name}</strong></div><div><small>{card.is_active?`${card.remaining_stamps} stamp${card.remaining_stamps===1?'':'s'} to go`:'Completed'}</small>{card.expires_at&&<span>Expires {date.format(new Date(card.expires_at))}</span>}</div></div><Link to={`/r/${card.restaurant_slug}`}>Order again</Link></article>):<div className="customer-stamps-empty"><h2>No stamp cards yet</h2><p>Qualifying completed orders will appear here automatically.</p><Link to="/restaurants">Browse restaurants</Link></div>}</section>
    <section className="customer-stamps-activity"><div><span>History</span><h2>Recent stamp activity</h2></div>{events.length?events.map(event=><article key={event.id}><i>{event.stamps_delta>0?'+':'−'}</i><div><strong>{event.program_name}</strong><span>{event.restaurant_name} · {event.note||event.event_type.replaceAll('_',' ')}</span></div><small>{date.format(new Date(event.created_at))}</small></article>):<p>No stamp activity yet.</p>}</section>
  </main>
}
