create or replace function public.platform_admin_delete_clinic(
  p_admin_user_id uuid,
  p_clinic_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clinic public.clinics%rowtype;
  v_confirmation text := btrim(coalesce(p_confirmation, ''));
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_admin_user_id
  ) then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select *
    into v_clinic
  from public.clinics
  where id = p_clinic_id
  for update;

  if not found then
    raise exception 'clinic_not_found' using errcode = 'P0002';
  end if;

  if v_confirmation = '' or (v_confirmation <> v_clinic.name and v_confirmation <> v_clinic.slug) then
    raise exception 'confirmation_mismatch' using errcode = '22023';
  end if;

  delete from public.notification_deliveries
   where notification_id in (
     select id from public.notifications where clinic_id = p_clinic_id
   );

  delete from public.notifications where clinic_id = p_clinic_id;
  delete from public.payments where clinic_id = p_clinic_id;
  delete from public.encounters where clinic_id = p_clinic_id;
  delete from public.medical_records where clinic_id = p_clinic_id;
  delete from public.appointments where clinic_id = p_clinic_id;
  delete from public.patients where clinic_id = p_clinic_id;
  delete from public.services where clinic_id = p_clinic_id;
  delete from public.clinic_domains where clinic_id = p_clinic_id;
  delete from public.memberships where clinic_id = p_clinic_id;
  delete from public.audit_log where clinic_id = p_clinic_id;
  delete from public.clinic_change_requests where clinic_id = p_clinic_id;
  delete from public.doctor_activation_requests where clinic_id = p_clinic_id;
  delete from public.clinic_subscriptions where clinic_id = p_clinic_id;
  delete from public.clinics where id = p_clinic_id;

  return jsonb_build_object(
    'ok', true,
    'clinic_id', p_clinic_id,
    'clinic_name', v_clinic.name,
    'clinic_slug', v_clinic.slug
  );
end;
$$;

revoke all on function public.platform_admin_delete_clinic(uuid, uuid, text) from public;
revoke all on function public.platform_admin_delete_clinic(uuid, uuid, text) from anon;
revoke all on function public.platform_admin_delete_clinic(uuid, uuid, text) from authenticated;
grant execute on function public.platform_admin_delete_clinic(uuid, uuid, text) to service_role;
