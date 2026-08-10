begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-invoices', 'restaurant-invoices', false, 10485760, array['application/pdf', 'text/csv'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.create_restaurant_invoice_download(
  p_invoice_id uuid,
  p_format text default 'pdf'
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  restaurant_id uuid;
  invoice_path text;
begin
  select rm.restaurant_id into restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;

  select case when p_format = 'csv' then i.csv_path else i.pdf_path end
  into invoice_path
  from public.restaurant_weekly_invoices i
  where i.id = p_invoice_id and i.restaurant_id = restaurant_id;

  if invoice_path is null then
    raise exception 'Invoice document is not available';
  end if;

  return invoice_path;
end;
$function$;

revoke all on function public.create_restaurant_invoice_download(uuid, text) from public, anon, authenticated;
grant execute on function public.create_restaurant_invoice_download(uuid, text) to authenticated;

commit;
