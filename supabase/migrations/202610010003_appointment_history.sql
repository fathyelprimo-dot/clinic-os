begin;

create index if not exists appointments_history_page_idx
  on public.appointments(clinic_id, scheduled_at, id);

create function public.clinic_booking_history(
  p_clinic uuid,
  p_after timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 500
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  role_name text = private.role_for(p_clinic);
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(jsonb_agg(page.row_data order by page.scheduled_at, page.id), '[]'::jsonb)
    into result
  from (
    select
      a.scheduled_at,
      a.id,
      to_jsonb(a) || jsonb_build_object('name', p.name, 'phone', p.phone, 'eta', null) as row_data
    from public.appointments a
    join public.patients p on (p.clinic_id, p.id) = (a.clinic_id, a.patient_id)
    where a.clinic_id = p_clinic
      and a.scheduled_at <= now() - interval '30 days'
      and (role_name is not null or p.user_id = auth.uid())
      and (p_after is null or (a.scheduled_at, a.id) > (p_after, p_after_id))
    order by a.scheduled_at, a.id
    limit greatest(1, least(coalesce(p_limit, 500), 500))
  ) as page;

  return result;
end
$$;

revoke all on function public.clinic_booking_history(uuid, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function public.clinic_booking_history(uuid, timestamptz, uuid, int) to authenticated;

commit;
