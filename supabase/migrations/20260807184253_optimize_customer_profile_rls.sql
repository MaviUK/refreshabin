drop policy if exists customer_profiles_insert_own on public.customer_profiles;
create policy customer_profiles_insert_own on public.customer_profiles for insert to public with check ((select auth.uid()) = user_id);
drop policy if exists customer_profiles_select_own on public.customer_profiles;
create policy customer_profiles_select_own on public.customer_profiles for select to public using ((select auth.uid()) = user_id);
drop policy if exists customer_profiles_update_own on public.customer_profiles;
create policy customer_profiles_update_own on public.customer_profiles for update to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
