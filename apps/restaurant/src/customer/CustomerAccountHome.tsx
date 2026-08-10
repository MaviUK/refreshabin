import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { usePlatformConfiguration } from '../lib/platformConfiguration'
import CustomerNotificationBell from './CustomerNotificationBell'
import './CustomerAccountHome.css'

type ReorderItem = {id:string;line_id:string;name:string;price_pence:number;unit_price_pence:number;quantity:number;removed_ingredients?:Array<{id:string;name:string}>;selected_extras?:Array<{id:string;name:string;price_pence:number;quantity:number}>;selected_modifier_groups?:Array<{group_id:string;group_name:string;options:Array<{id:string;name:string;price_pence:number;quantity:number}>}>;special_instructions?:string|null}
type ReorderResponse={restaurant_slug:string;items:ReorderItem[];unavailable_items:Array<{name:string;quantity:number}>;price_changed_items:Array<{name:string;old_price_pence:number;new_price_pence:number}>}
type CustomerOrderSummary={id:string;order_number:number;restaurant_name:string;restaurant_slug:string;order_status:string;total_pence:number;created_at:string}
type AccountSummary={firstName:string;email:string;orderCount:number;addressCount:number;favouriteCount:number;latestOrder:CustomerOrderSummary|null}
const money=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'});const date=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'});const formatStatus=(value:string)=>value.replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase())

export default function CustomerAccountHome(){const{configuration}=usePlatformConfiguration(),favouritesEnabled=configuration.feature_flags.customer_favourites,navigate=useNavigate();const[summary,setSummary]=useState<AccountSummary|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[signingOut,setSigningOut]=useState(false),[reordering,setReordering]=useState(false)
 useEffect(()=>{let active=true;async function loadAccount(){setLoading(true);setError('');try{const{data:sessionData,error:sessionError}=await supabase.auth.getSession();const user=sessionData.session?.user;if(sessionError||!user){navigate('/account/login',{replace:true,state:{from:'/account'}});return}const fallbackSummary:AccountSummary={firstName:'',email:user.email||'',orderCount:0,addressCount:0,favouriteCount:0,latestOrder:null};if(!active)return;setSummary(fallbackSummary);setLoading(false);const claimResult=await supabase.rpc('claim_customer_orders');if(claimResult.error)console.warn('Unable to claim previous customer orders',claimResult.error);const results=await Promise.allSettled([supabase.from('customer_profiles').select('first_name').eq('user_id',user.id).maybeSingle(),supabase.rpc('get_customer_order_history'),supabase.from('customer_addresses').select('id',{count:'exact',head:true}).eq('user_id',user.id),supabase.from('customer_favourite_restaurants').select('restaurant_id',{count:'exact',head:true}).eq('user_id',user.id),supabase.from('customer_favourite_items').select('menu_item_id',{count:'exact',head:true}).eq('user_id',user.id)]);if(!active)return;const[profileSettled,ordersSettled,addressesSettled,restaurantFavouritesSettled,itemFavouritesSettled]=results;const profileResult=profileSettled.status==='fulfilled'?profileSettled.value:null,ordersResult=ordersSettled.status==='fulfilled'?ordersSettled.value:null,addressesResult=addressesSettled.status==='fulfilled'?addressesSettled.value:null,restaurantFavouritesResult=restaurantFavouritesSettled.status==='fulfilled'?restaurantFavouritesSettled.value:null,itemFavouritesResult=itemFavouritesSettled.status==='fulfilled'?itemFavouritesSettled.value:null;const accountOrders=((ordersResult?.data||[]) as CustomerOrderSummary[]).sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());setSummary({firstName:profileResult?.error?'':profileResult?.data?.first_name||'',email:user.email||'',orderCount:ordersResult?.error?0:accountOrders.length,addressCount:addressesResult?.error?0:addressesResult?.count||0,favouriteCount:(restaurantFavouritesResult?.error?0:restaurantFavouritesResult?.count||0)+(itemFavouritesSettled.status==='fulfilled'&&!itemFavouritesSettled.value.error?itemFavouritesSettled.value.count||0:0),latestOrder:ordersResult?.error?null:accountOrders[0]||null});const hadFailure=results.some(result=>result.status==='rejected')||Boolean(profileResult?.error||ordersResult?.error||addressesResult?.error||restaurantFavouritesResult?.error||(itemFavouritesSettled.status==='fulfilled'&&itemFavouritesSettled.value.error));if(hadFailure)setError('Some account information could not be loaded, but your account is still available.')}catch(loadError){console.error('Customer account failed to load',loadError);if(active){setError('Some account information could not be loaded, but your account is still available.');setLoading(false)}}}void loadAccount();return()=>{active=false}},[navigate])
 async function signOut(){setSigningOut(true);await supabase.auth.signOut();navigate('/restaurants',{replace:true})}
 async function reorderLatest(){if(!summary?.latestOrder||reordering)return;setReordering(true);setError('');const{data,error:reorderError}=await supabase.rpc('get_customer_reorder_basket',{target_order_id:summary.latestOrder.id});if(reorderError){setError(reorderError.message);setReordering(false);return}const result=data as ReorderResponse;if(!result.items.length){setError('None of the items from your latest order are currently available.');setReordering(false);return}const warnings:string[]=[];if(result.unavailable_items.length)warnings.push(`${result.unavailable_items.length} unavailable item${result.unavailable_items.length===1?'':'s'} will be left out.`);if(result.price_changed_items.length)warnings.push(`${result.price_changed_items.length} item${result.price_changed_items.length===1?' has':'s have'} changed price.`);if(warnings.length&&!window.confirm(`${warnings.join('\n')}\n\nContinue with the available items?`)){setReordering(false);return}const basket=Object.fromEntries(result.items.map(item=>[item.line_id,item]));window.localStorage.setItem(`ordered-food-basket:${result.restaurant_slug}`,JSON.stringify(basket));navigate(`/r/${result.restaurant_slug}`)}
 if(loading&&!summary)return <main className="customer-home-state">Loading your account…</main>;const account=summary||{firstName:'',email:'',orderCount:0,addressCount:0,favouriteCount:0,latestOrder:null}

 const shortcut=(to:string,icon:string,title:string,subtitle:string,accent='teal')=><Link to={to} className={`customer-home-shortcut ${accent}`}><span className="customer-home-icon">{icon}</span><div><strong>{title}</strong><small>{subtitle}</small></div><span className="customer-home-arrow">›</span></Link>

 return <main className="customer-home-page">
  <header className="customer-home-header"><Link className="customer-home-brand" to="/restaurants">ordered.food</Link><div className="customer-home-header-actions"><CustomerNotificationBell/><button type="button" onClick={signOut} disabled={signingOut}>{signingOut?'Signing out…':'Sign out'}</button></div></header>

  <section className="customer-home-welcome">
   <div><span className="customer-home-eyebrow">Your account</span><h1>{account.firstName?`Hi, ${account.firstName}`:'Welcome back'}</h1>{account.email&&<p>{account.email}</p>}</div>
   <Link className="customer-home-find-food" to="/restaurants"><span>＋</span> Find food</Link>
  </section>

  <section className="customer-home-stats" aria-label="Account overview">
   <Link to="/account/orders"><strong>{account.orderCount}</strong><span>Orders</span></Link>
   <Link to="/account/addresses"><strong>{account.addressCount}</strong><span>Addresses</span></Link>
   {favouritesEnabled&&<Link to="/account/favourites"><strong>{account.favouriteCount}</strong><span>Favourites</span></Link>}
  </section>

  {error&&<div className="customer-home-error" role="alert">{error}</div>}

  <section className="customer-home-latest customer-home-latest-featured">
   <div className="customer-home-section-heading"><div><span>Quick reorder</span><h2>Latest order</h2></div><Link to="/account/orders">All orders</Link></div>
   {account.latestOrder?<article><div className="customer-home-order-main"><span>Order #{account.latestOrder.order_number}</span><h3>{account.latestOrder.restaurant_name}</h3><small>{date.format(new Date(account.latestOrder.created_at))}</small></div><div className="customer-home-order-meta"><strong>{money.format(account.latestOrder.total_pence/100)}</strong><span>{formatStatus(account.latestOrder.order_status)}</span></div><button type="button" onClick={()=>void reorderLatest()} disabled={reordering}>{reordering?'Building basket…':'Order again'}</button></article>:<div className="customer-home-empty"><p>You have not placed an order yet.</p><Link to="/restaurants">Browse restaurants</Link></div>}
  </section>

  <section className="customer-home-group"><div className="customer-home-group-title"><span>Everyday</span><h2>Order & rewards</h2></div><div className="customer-home-grid compact">
   {shortcut('/account/orders','↻','Orders',`${account.orderCount} order${account.orderCount===1?'':'s'}`,'pink')}
   {favouritesEnabled&&shortcut('/account/favourites','♥','Favourites',`${account.favouriteCount} saved`,'pink')}
   {shortcut('/account/wallet','£','Wallet','Credit and gift cards')}
   {shortcut('/account/loyalty','★','Loyalty','Points and rewards')}
   {shortcut('/account/stamps','●','Stamp cards','Collect and redeem stamps')}
   {shortcut('/account/referrals','↗','Referrals','Invite friends and earn')}
  </div></section>

  <section className="customer-home-group"><div className="customer-home-group-title"><span>More for you</span><h2>Benefits & progress</h2></div><div className="customer-home-grid compact">
   {shortcut('/account/challenges','◆','Challenges','Missions and achievements')}
   {shortcut('/account/vip','✦','VIP memberships','Tiers and benefits')}
   {shortcut('/account/milestones','★','Milestones','Birthday and progress rewards')}
   {shortcut('/account/notifications','◇','Notifications','Rewards and reminders')}
  </div></section>

  <section className="customer-home-group customer-home-group-last"><div className="customer-home-group-title"><span>Account</span><h2>Details & preferences</h2></div><div className="customer-home-grid compact">
   {shortcut('/account/addresses','⌂','Addresses',`${account.addressCount} saved`)}
   {shortcut('/account/profile','◉','Your details','Name, mobile and security')}
   {shortcut('/account/marketing-preferences','✉','Preferences','Email and communication')}
  </div></section>
 </main>}
