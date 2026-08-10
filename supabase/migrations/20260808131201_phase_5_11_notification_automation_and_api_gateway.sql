create or replace function private.restaurant_group_scope_allowed(p_group_id uuid,p_permission text,p_scope_type text,p_scope_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if auth.role()='service_role' then return true; end if;
 if p_scope_type='group' then return private.restaurant_group_member_permission(p_group_id,p_permission);
 elsif p_scope_type='brand' then return private.restaurant_group_member_permission(p_group_id,p_permission,null,p_scope_id,null);
 elsif p_scope_type='region' then return private.restaurant_group_member_permission(p_group_id,p_permission,null,null,p_scope_id);
 elsif p_scope_type='restaurant' then return private.restaurant_group_member_permission(p_group_id,p_permission,p_scope_id,null,null);
 end if;
 return false;
end $$;

create or replace function public.get_restaurant_group_feature_scope(p_restaurant_id uuid,p_feature text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.restaurant_group_locations%rowtype; v_scope text; v_ids jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into l from public.restaurant_group_locations where restaurant_id=p_restaurant_id;
 if not found then return jsonb_build_object('scope','restaurant','restaurant_ids',jsonb_build_array(p_restaurant_id)); end if;
 if not (
   private.restaurant_group_member_of(l.group_id)
   or private.restaurant_member_of(p_restaurant_id)
   or exists(select 1 from public.orders o where o.restaurant_id=p_restaurant_id and o.customer_user_id=auth.uid())
 ) then raise exception 'Restaurant relationship required' using errcode='42501'; end if;
 v_scope:=coalesce(private.restaurant_group_feature_scope(l.group_id,p_feature),'restaurant');
 select coalesce(jsonb_agg(x.restaurant_id order by x.restaurant_id),'[]'::jsonb) into v_ids from private.restaurant_group_feature_restaurants(p_restaurant_id,p_feature) x;
 return jsonb_build_object('group_id',l.group_id,'scope',v_scope,'restaurant_ids',v_ids);
end $$;

create or replace function private.enqueue_restaurant_group_notification(
 p_group_id uuid,
 p_notification_type text,
 p_title text,
 p_body text,
 p_audience_roles text[] default array[]::text[],
 p_scope_type text default 'group',
 p_scope_id uuid default null,
 p_action_url text default null,
 p_priority text default 'normal',
 p_metadata jsonb default '{}'::jsonb,
 p_dedupe_key text default null,
 p_created_by uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; u record; v_email boolean;
begin
 insert into public.restaurant_group_notifications(group_id,notification_type,title,body,action_url,priority,audience_roles,audience_scope_type,audience_scope_id,metadata,dedupe_key,created_by)
 values(p_group_id,p_notification_type,btrim(p_title),btrim(p_body),p_action_url,p_priority,coalesce(p_audience_roles,array[]::text[]),p_scope_type,p_scope_id,coalesce(p_metadata,'{}'::jsonb),p_dedupe_key,p_created_by)
 on conflict(group_id,dedupe_key) do update set title=excluded.title,body=excluded.body,metadata=excluded.metadata returning id into v_id;
 select coalesce(central_notifications_enabled,false) into v_email from public.restaurant_group_enterprise_settings where group_id=p_group_id;
 for u in select * from private.restaurant_group_notification_recipients(v_id) loop
   insert into public.restaurant_group_notification_deliveries(notification_id,group_id,user_id,channel) values(v_id,p_group_id,u.user_id,'in_app') on conflict do nothing;
   if v_email then insert into public.restaurant_group_notification_deliveries(notification_id,group_id,user_id,channel) values(v_id,p_group_id,u.user_id,'email') on conflict do nothing; end if;
 end loop;
 return v_id;
end $$;

create or replace function public.create_restaurant_group_notification(p_group_id uuid,p_title text,p_body text,p_notification_type text,p_audience_roles text[] default array[]::text[],p_scope_type text default 'group',p_scope_id uuid default null,p_action_url text default null,p_priority text default 'normal',p_metadata jsonb default '{}'::jsonb,p_dedupe_key text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_member_permission(p_group_id,'notifications:manage') then raise exception 'Notification management permission required' using errcode='42501'; end if;
 v_id:=private.enqueue_restaurant_group_notification(p_group_id,p_notification_type,p_title,p_body,p_audience_roles,p_scope_type,p_scope_id,p_action_url,p_priority,p_metadata,p_dedupe_key,auth.uid());
 perform private.restaurant_group_log(p_group_id,'notification.created','group_notification',v_id,null,jsonb_build_object('scope_type',p_scope_type,'scope_id',p_scope_id,'roles',p_audience_roles));
 return v_id;
end $$;

create or replace function private.restaurant_group_audit_notification_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare roles text[]; title text; body text; scope_type text:='group'; scope_id uuid; priority text:='normal';
begin
 if new.action like 'notification.%' then return new; end if;
 if new.action like 'location.%' then
   roles:=array['corporate_admin','regional_manager','brand_manager','restaurant_owner']; title:='Location update'; body:='A restaurant location changed in your organisation.'; scope_type:=case when new.target_type='restaurant' and new.target_id is not null then 'restaurant' else 'group' end; scope_id:=case when scope_type='restaurant' then new.target_id end;
 elsif new.action like 'menu.%' or new.action like 'pricing.%' then
   roles:=array['corporate_admin','regional_manager','brand_manager','restaurant_owner','restaurant_manager','kitchen']; title:='Menu or pricing update'; body:='A centrally managed menu or pricing change was published.';
 elsif new.action like 'campaign.%' then
   roles:=array['corporate_admin','regional_manager','brand_manager','marketing']; title:='Marketing campaign update'; body:='A central marketing campaign was published to organisation locations.';
 elsif new.action like 'enterprise.%' or new.action like 'api_key.%' or new.action like 'integration.%' then
   roles:=array['corporate_admin']; title:='Enterprise configuration update'; body:='Enterprise configuration changed for your organisation.';
 elsif new.action like 'organisation.%' or new.action like 'brand.%' or new.action like 'region.%' then
   roles:=array['corporate_admin','regional_manager','brand_manager']; title:='Organisation structure update'; body:='Your organisation structure or status changed.';
 elsif new.action like 'staff.%' or new.action like 'role.%' or new.action like 'department.%' then
   roles:=array['corporate_admin','regional_manager','brand_manager','restaurant_owner']; title:='Staff and permissions update'; body:='Staff access or organisation permissions changed.';
 else return new; end if;
 if new.action in('organisation.suspend','organisation.archive') then priority:='critical'; end if;
 perform private.enqueue_restaurant_group_notification(new.group_id,'audit_event',title,body,roles,scope_type,scope_id,'/enterprise',priority,jsonb_build_object('audit_log_id',new.id,'action',new.action,'target_type',new.target_type,'target_id',new.target_id,'reason',new.reason),'audit:'||new.id::text,new.actor_user_id);
 return new;
end $$;
drop trigger if exists restaurant_group_audit_notify on public.restaurant_group_audit_log;
create trigger restaurant_group_audit_notify after insert on public.restaurant_group_audit_log for each row execute function private.restaurant_group_audit_notification_trigger();

create or replace function private.restaurant_group_finance_notification_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare gid uuid; roles text[]:=array['corporate_admin','finance','restaurant_owner']; label text; dedupe text; priority text:='normal';
begin
 select group_id into gid from public.restaurant_group_locations where restaurant_id=new.restaurant_id and status in('active','suspended');
 if gid is null then return new; end if;
 if tg_table_name='restaurant_weekly_invoices' then
   if tg_op='UPDATE' and new.status is not distinct from old.status and new.refunded_pence is not distinct from old.refunded_pence then return new; end if;
   label:='Weekly finance update'; dedupe:='weekly-invoice:'||new.id::text||':'||new.status||':'||coalesce(new.refunded_pence,0)::text;
   if new.status in('failed','overdue') then priority:='high'; end if;
   perform private.enqueue_restaurant_group_notification(gid,'finance',label,'A weekly restaurant invoice changed status to '||new.status||'.',roles,'restaurant',new.restaurant_id,'/finance',priority,jsonb_build_object('invoice_id',new.id,'invoice_number',new.invoice_number,'status',new.status,'refunded_pence',new.refunded_pence),dedupe,null);
 elsif tg_table_name='restaurant_subscriptions' then
   if tg_op='UPDATE' and new.status is not distinct from old.status and new.last_payment_failed_at is not distinct from old.last_payment_failed_at then return new; end if;
   label:='Subscription billing update'; dedupe:='subscription:'||new.id::text||':'||new.status||':'||coalesce(new.last_payment_failed_at::text,'ok');
   if new.status in('past_due','unpaid','cancelled') or new.last_payment_failed_at is not null then priority:='high'; end if;
   perform private.enqueue_restaurant_group_notification(gid,'billing',label,'A restaurant subscription changed status to '||new.status||'.',roles,'restaurant',new.restaurant_id,'/subscription',priority,jsonb_build_object('subscription_id',new.id,'status',new.status,'last_payment_failed_at',new.last_payment_failed_at),dedupe,null);
 end if;
 return new;
end $$;
drop trigger if exists restaurant_group_weekly_invoice_notify on public.restaurant_weekly_invoices;
create trigger restaurant_group_weekly_invoice_notify after insert or update on public.restaurant_weekly_invoices for each row execute function private.restaurant_group_finance_notification_trigger();
drop trigger if exists restaurant_group_subscription_notify on public.restaurant_subscriptions;
create trigger restaurant_group_subscription_notify after insert or update on public.restaurant_subscriptions for each row execute function private.restaurant_group_finance_notification_trigger();

create or replace function public.resolve_restaurant_group_api_key(p_raw_key text,p_required_scope text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gid uuid; k public.restaurant_group_api_keys%rowtype; g public.restaurant_groups%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into k from public.restaurant_group_api_keys where key_hash=encode(digest(p_raw_key,'sha256'),'hex') and status='active' and(expires_at is null or expires_at>now()) and(p_required_scope is null or p_required_scope=any(scopes)) for update;
 if not found then return null; end if;
 select * into g from public.restaurant_groups where id=k.group_id and status='active'; if not found then return null; end if;
 update public.restaurant_group_api_keys set last_used_at=now() where id=k.id;
 return jsonb_build_object('key_id',k.id,'group_id',k.group_id,'group_name',g.name,'scopes',k.scopes,'expires_at',k.expires_at);
end $$;
revoke all on function public.resolve_restaurant_group_api_key(text,text) from public,anon,authenticated;
grant execute on function public.resolve_restaurant_group_api_key(text,text) to service_role;

revoke all on function private.enqueue_restaurant_group_notification(uuid,text,text,text,text[],text,uuid,text,text,jsonb,text,uuid) from public;
