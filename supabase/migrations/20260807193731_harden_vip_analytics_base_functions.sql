revoke all on function public.get_restaurant_vip_dashboard_base() from authenticated;
revoke all on function public.get_platform_vip_dashboard_base() from authenticated;
grant execute on function public.get_restaurant_vip_dashboard_base(), public.get_platform_vip_dashboard_base() to service_role;
