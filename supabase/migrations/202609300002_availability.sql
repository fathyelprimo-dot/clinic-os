begin;
grant usage on schema private to anon;
grant execute on function private.role_for(uuid) to anon;
create function public.available_slots(p_clinic uuid,p_service uuid,p_date date) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;s public.services;result jsonb;
begin
 select * into c from public.clinics where id=p_clinic and published;
 select * into s from public.services where id=p_service and clinic_id=p_clinic and active;
 if c.id is null or s.id is null or p_date<(now() at time zone 'Africa/Cairo')::date or p_date>(now() at time zone 'Africa/Cairo')::date+30 then raise exception 'Invalid availability request';end if;
 select coalesce(jsonb_agg(to_char(t at time zone 'Africa/Cairo','HH24:MI') order by t),'[]'::jsonb) into result from generate_series((p_date+c.opens) at time zone 'Africa/Cairo',((p_date+c.closes) at time zone 'Africa/Cairo')-s.duration_minutes*interval '1 minute',interval '5 minutes')t
 where t>now() and not exists(select 1 from public.appointments a where a.clinic_id=p_clinic and a.status<>'cancelled' and tstzrange(a.scheduled_at,a.scheduled_at+a.duration_minutes*interval '1 minute','[)') && tstzrange(t,t+s.duration_minutes*interval '1 minute','[)'));
 return result;
end$$;
revoke all on function public.available_slots(uuid,uuid,date) from public;
grant execute on function public.available_slots(uuid,uuid,date) to anon,authenticated;
commit;
