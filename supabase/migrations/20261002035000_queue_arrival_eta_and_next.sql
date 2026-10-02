begin;

-- A patient who has checked in is ready for the queue even when the booked
-- slot is later. Unchecked missed visits stop inflating every patient's ETA.
create or replace function private.queue_estimates(c uuid,d date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 result jsonb='{}';
 cursor_at timestamptz=now();
 ready_at timestamptz;
 r public.appointments;
 done_ids uuid[]='{}';
 duration numeric;
 mins int;
 is_paused boolean;
 buf int;
begin
 select paused,buffer_minutes into is_paused,buf from public.clinics where id=c;
 if is_paused then return '{}'::jsonb;end if;

 select coalesce(jsonb_object_agg(a.id::text,jsonb_build_object('minutes',null,'reason','arrival')),'{}'::jsonb)
 into result
 from public.appointments a
 where a.clinic_id=c and a.status='waiting' and a.triage='approved'
   and (a.scheduled_at at time zone 'Africa/Cairo')::date=d
   and not a.arrived and a.scheduled_at<=now()-interval '15 minutes';

 select * into r from public.appointments
 where clinic_id=c and status='inside'
   and (scheduled_at at time zone 'Africa/Cairo')::date=d
 order by started_at desc nulls last,id
 limit 1;
 if r.id is not null then
  cursor_at=now()+greatest(3,r.duration_minutes-extract(epoch from(now()-coalesce(r.started_at,now())))/60)*interval '1 minute';
  result=result||jsonb_build_object(r.id,jsonb_build_object('minutes',0,'low',0,'high',0));
 end if;

 loop
  select * into r
  from public.appointments
  where clinic_id=c and status='waiting' and triage='approved'
    and (scheduled_at at time zone 'Africa/Cairo')::date=d
    and (arrived or scheduled_at>now()-interval '15 minutes')
    and not(id=any(done_ids))
  order by greatest(case when arrived then now() else scheduled_at end,cursor_at),
           priority desc,scheduled_at,id
  limit 1;
  exit when r.id is null;

  ready_at=case when r.arrived then now() else r.scheduled_at end;
  cursor_at=greatest(cursor_at,ready_at);
  mins=greatest(0,ceil(extract(epoch from(cursor_at-now()))/60));
  result=result||jsonb_build_object(
    r.id,
    jsonb_build_object(
      'minutes',mins,
      'low',greatest(0,mins-buf),
      'high',mins+buf,
      'leaveIn',case when r.arrived then null else greatest(0,mins-r.travel_minutes-buf) end,
      'expectedAt',cursor_at
    )
  );

  select case when count(*)>=3
    then greatest(r.duration_minutes*.5,least(r.duration_minutes*3,avg(v.minutes)))
    else r.duration_minutes
  end
  into duration
  from (
    select extract(epoch from(finished_at-started_at))/60 as minutes
    from public.appointments
    where clinic_id=c and service_id=r.service_id and status='done'
      and finished_at>started_at
      and extract(epoch from(finished_at-started_at))/60 between 1 and 240
    order by finished_at desc
    limit 20
  ) v;
  cursor_at=cursor_at+duration*interval '1 minute';
  done_ids=array_append(done_ids,r.id);
 end loop;
 return result;
end
$$;

create or replace function public.staff_action(
 p_clinic uuid,p_action text,p_appointment uuid default null,p_expected uuid default null
) returns void
language plpgsql
security definer
set search_path=''
as $$
declare
 role_name text=private.role_for(p_clinic);
 a public.appointments;
 current_id uuid;
 next_id uuid;
begin
 if role_name is null then raise exception 'Staff only';end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));

 if p_action in ('pause','resume') then
  update public.clinics set paused=(p_action='pause') where id=p_clinic;
 elsif p_action='next' then
  if (select paused from public.clinics where id=p_clinic) then raise exception 'Queue paused';end if;
  select id into current_id
  from public.appointments
  where clinic_id=p_clinic and status='inside'
  order by started_at desc nulls last,id
  limit 1;
  if current_id is distinct from p_expected then raise exception 'Queue changed; refresh first';end if;

  select id into next_id
  from public.appointments
  where clinic_id=p_clinic and status='waiting' and arrived and triage='approved'
    and (scheduled_at at time zone 'Africa/Cairo')::date=(now() at time zone 'Africa/Cairo')::date
  order by priority desc,scheduled_at,id
  limit 1;

  if current_id is null and next_id is null then raise exception 'No patient ready';end if;
  if current_id is not null then
   update public.appointments set status='done',finished_at=now() where id=current_id;
  end if;
  if next_id is not null then
   update public.appointments set status='inside',started_at=now() where id=next_id;
  end if;
 else
  select * into a
  from public.appointments
  where id=p_appointment and clinic_id=p_clinic
  for update;
  if a.id is null then raise exception 'Appointment unavailable';end if;
  if p_action='arrive' and a.status='waiting' then
   update public.appointments set arrived=true where id=a.id;
  elsif p_action='approve' and role_name='doctor' and a.status='waiting' then
   update public.appointments set triage='approved' where id=a.id;
  elsif p_action='cancel' and a.status='waiting' and not a.paid then
   update public.appointments set status='cancelled' where id=a.id;
  elsif p_action='pay' and a.status<>'cancelled' and not a.paid then
   insert into public.payments(clinic_id,appointment_id,amount,method,received_by)
   values(p_clinic,a.id,a.price,a.payment_method,auth.uid());
   update public.appointments set paid=true where id=a.id;
  else
   raise exception 'Action not allowed for current state';
  end if;
 end if;

 insert into public.audit_log(clinic_id,actor,action,record_id)
 values(p_clinic,auth.uid(),p_action,p_appointment);
end
$$;

commit;
