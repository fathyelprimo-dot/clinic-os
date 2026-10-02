-- Enforce owner activation and subscription expiry in reads, writes, queue actions and delivery.
create or replace function private.clinic_access_enabled(p_clinic uuid)
returns boolean
language sql stable security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.clinics c
    where c.id=p_clinic
      and c.is_active
      and not exists (
        select 1 from public.clinic_subscriptions s
        where s.clinic_id=c.id
          and s.ends_on < (now() at time zone 'Africa/Cairo')::date
      )
  )
$$;
revoke all on function private.clinic_access_enabled(uuid) from public;
grant execute on function private.clinic_access_enabled(uuid) to anon,authenticated,service_role;

-- Keep RLS effective even when an old staff session remains signed in.
drop policy if exists bookings_scope on public.appointments;
create policy bookings_scope on public.appointments for select to authenticated
using (private.clinic_access_enabled(clinic_id) and
       (private.role_for(clinic_id) is not null or private.owns_patient(clinic_id,patient_id)));

drop policy if exists audit_doctor on public.audit_log;
create policy audit_doctor on public.audit_log for select to authenticated
using (private.clinic_access_enabled(clinic_id) and private.role_for(clinic_id)='doctor');

drop policy if exists clinics_public on public.clinics;
drop policy if exists public_clinic on public.clinics;
create policy public_clinic on public.clinics for select
using (private.clinic_access_enabled(id) and (published or private.role_for(id) is not null));

drop policy if exists encounters_doctor on public.encounters;
create policy encounters_doctor on public.encounters for select to authenticated
using (private.clinic_access_enabled(clinic_id) and private.role_for(clinic_id)='doctor');

drop policy if exists records_doctor on public.medical_records;
create policy records_doctor on public.medical_records for select to authenticated
using (private.clinic_access_enabled(clinic_id) and private.role_for(clinic_id)='doctor');

drop policy if exists notices_scope on public.notifications;
create policy notices_scope on public.notifications for select to authenticated
using (private.clinic_access_enabled(clinic_id) and
       (private.role_for(clinic_id) is not null or private.owns_patient(clinic_id,patient_id)));

drop policy if exists contacts_scope on public.patients;
create policy contacts_scope on public.patients for select to authenticated
using (private.clinic_access_enabled(clinic_id) and
       (private.role_for(clinic_id) is not null or user_id=(select auth.uid())));

drop policy if exists receipts_staff on public.payments;
create policy receipts_staff on public.payments for select to authenticated
using (private.clinic_access_enabled(clinic_id) and private.role_for(clinic_id) is not null);

drop policy if exists public_service on public.services;
create policy public_service on public.services for select
using (private.clinic_access_enabled(clinic_id) and
       ((exists(select 1 from public.clinics c where c.id=services.clinic_id and c.published))
        or private.role_for(clinic_id) is not null));

-- An inactive or expired tenant cannot be resolved, booked, edited or operated by an old session.
create or replace function public.resolve_clinic(p_host text,p_slug text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;
begin
 select cl.* into c
 from public.clinics cl
 join public.clinic_domains d on d.clinic_id=cl.id
 where d.hostname=lower(p_host) and d.verified and cl.published
   and private.clinic_access_enabled(cl.id);
 if c.id is null then
   select * into c from public.clinics cl
   where cl.slug=p_slug and cl.published and private.clinic_access_enabled(cl.id);
 end if;
 if c.id is null then raise exception 'Clinic unavailable';end if;
 return jsonb_build_object(
   'clinic',to_jsonb(c),
   'services',(select coalesce(jsonb_agg(s order by s.priority),'[]'::jsonb)
               from public.services s where clinic_id=c.id and active)
 );
end$$;

create or replace function public.available_slots(p_clinic uuid,p_service uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;s public.services;result jsonb;
begin
 select * into c from public.clinics where id=p_clinic and published and private.clinic_access_enabled(id);
 select * into s from public.services where id=p_service and clinic_id=p_clinic and active;
 if c.id is null or s.id is null
    or p_date<(now() at time zone 'Africa/Cairo')::date
    or p_date>(now() at time zone 'Africa/Cairo')::date+30 then
   raise exception 'Invalid availability request';
 end if;
 select coalesce(jsonb_agg(to_char(t at time zone 'Africa/Cairo','HH24:MI') order by t),'[]'::jsonb)
 into result
 from generate_series(
   (p_date+c.opens) at time zone 'Africa/Cairo',
   ((p_date+c.closes) at time zone 'Africa/Cairo')-s.duration_minutes*interval '1 minute',
   interval '5 minutes'
 ) t
 where t>now() and not exists(
   select 1 from public.appointments a
   where a.clinic_id=p_clinic and a.status<>'cancelled'
     and tstzrange(a.scheduled_at,a.scheduled_at+a.duration_minutes*interval '1 minute','[)')
         && tstzrange(t,t+s.duration_minutes*interval '1 minute','[)')
 );
 return result;
end$$;

create or replace function public.book_appointment(
 p_clinic uuid,p_service uuid,p_name text,p_phone text,p_date date,p_time time,
 p_payment text,p_travel int,p_consent boolean,p_request uuid,p_patient uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;s public.services;p uuid;a public.appointments;t timestamptz;
 role_name text=private.role_for(p_clinic);verified_phone text;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 select * into a from public.appointments
 where clinic_id=p_clinic and requested_by=auth.uid() and request_key=p_request;
 if a.id is not null then return to_jsonb(a);end if;
 select * into c from public.clinics
 where id=p_clinic and published and private.clinic_access_enabled(id);
 select * into s from public.services where clinic_id=p_clinic and id=p_service and active;
 if c.id is null or s.id is null then raise exception 'Clinic or service unavailable';end if;
 if length(trim(p_name)) not between 3 and 80 or p_phone !~ '^01[0125][0-9]{8}$' then
   raise exception 'Invalid contact details';
 end if;
 if role_name is null then
   select phone into verified_phone from auth.users
   where id=auth.uid() and phone_confirmed_at is not null;
   if verified_phone is null or regexp_replace(verified_phone,'^\+','')<>'20'||substring(p_phone from 2) then
     raise exception 'Verify your phone before booking';
   end if;
   if (select count(*) from public.appointments where requested_by=auth.uid() and created_at>now()-interval '1 hour')>=5 then
     raise exception 'Booking limit reached';
   end if;
 end if;
 if p_date<(now() at time zone 'Africa/Cairo')::date
    or p_date>(now() at time zone 'Africa/Cairo')::date+30 then raise exception 'Date outside booking window';end if;
 t=(p_date+p_time) at time zone 'Africa/Cairo';
 if t<now() or p_time<c.opens or p_time+s.duration_minutes*interval '1 minute'>c.closes then
   raise exception 'Outside clinic hours';
 end if;
 if exists(select 1 from public.appointments where clinic_id=p_clinic and status<>'cancelled'
   and tstzrange(scheduled_at,scheduled_at+duration_minutes*interval '1 minute','[)')
       && tstzrange(t,t+s.duration_minutes*interval '1 minute','[)')) then
   raise exception 'Slot unavailable';
 end if;
 if p_payment='instapay' and c.instapay='' or p_payment='wallet' and c.wallet='' then
   raise exception 'Payment method unavailable';
 end if;
 if role_name is null then
   insert into public.patients(clinic_id,user_id,name,phone)
   values(p_clinic,auth.uid(),trim(p_name),p_phone)
   on conflict(clinic_id,user_id) do update set name=excluded.name,phone=excluded.phone
   returning id into p;
 else
   if p_patient is not null then
     select id into p from public.patients where id=p_patient and clinic_id=p_clinic;
     if p is null then raise exception 'Patient unavailable';end if;
   else
     insert into public.patients(clinic_id,name,phone) values(p_clinic,trim(p_name),p_phone) returning id into p;
   end if;
 end if;
 insert into public.appointments(
   clinic_id,patient_id,service_id,requested_by,request_key,scheduled_at,
   service_name,price,duration_minutes,priority,category,triage,payment_method,
   travel_minutes,notification_consent
 ) values(
   p_clinic,p,s.id,auth.uid(),p_request,t,s.name,s.price,s.duration_minutes,s.priority,
   s.category,case when s.category='emergency' then 'pending' else 'approved' end,
   p_payment,p_travel,p_consent
 ) returning * into a;
 return to_jsonb(a);
end$$;

create or replace function public.clinic_snapshot(p_clinic uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text=private.role_for(p_clinic);result jsonb;eta jsonb='{}';d date;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 for d in select distinct (scheduled_at at time zone 'Africa/Cairo')::date
          from public.appointments where clinic_id=p_clinic and status in ('waiting','inside')
 loop eta=eta||private.queue_estimates(p_clinic,d);end loop;
 select jsonb_build_object(
   'role',coalesce(role_name,'patient'),
   'bookings',coalesce((
     select jsonb_agg(to_jsonb(a)||jsonb_build_object('name',p.name,'phone',p.phone,'eta',eta->a.id::text)
                      order by a.scheduled_at)
     from public.appointments a join public.patients p on (p.clinic_id,p.id)=(a.clinic_id,a.patient_id)
     where a.clinic_id=p_clinic and (role_name is not null or p.user_id=auth.uid())
       and a.scheduled_at>now()-interval '30 days'
   ),'[]'::jsonb),
   'notifications',coalesce((
     select jsonb_agg(n) from public.notifications n
     where clinic_id=p_clinic and (role_name is not null or private.owns_patient(p_clinic,n.patient_id))
       and created_at>now()-interval '7 days'
   ),'[]'::jsonb)
 ) into result;
 return result;
end$$;

create or replace function public.clinic_booking_history(
 p_clinic uuid,p_after timestamptz default null,p_after_id uuid default null,p_limit integer default 500
) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text=private.role_for(p_clinic);result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 select coalesce(jsonb_agg(page.row_data order by page.scheduled_at,page.id),'[]'::jsonb)
 into result
 from (
   select a.scheduled_at,a.id,to_jsonb(a)||jsonb_build_object('name',p.name,'phone',p.phone,'eta',null) as row_data
   from public.appointments a
   join public.patients p on (p.clinic_id,p.id)=(a.clinic_id,a.patient_id)
   where a.clinic_id=p_clinic and a.scheduled_at<=now()-interval '30 days'
     and (role_name is not null or p.user_id=auth.uid())
     and (p_after is null or (a.scheduled_at,a.id)>(p_after,p_after_id))
   order by a.scheduled_at,a.id limit greatest(1,least(coalesce(p_limit,500),500))
 ) as page;
 return result;
end$$;

create or replace function public.staff_action(
 p_clinic uuid,p_action text,p_appointment uuid default null,p_expected uuid default null
) returns void language plpgsql security definer set search_path='' as $$
declare role_name text=private.role_for(p_clinic);a public.appointments;current_id uuid;next_id uuid;
begin
 if role_name is null then raise exception 'Staff only';end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 if p_action in ('pause','resume') then
   update public.clinics set paused=(p_action='pause') where id=p_clinic;
 elsif p_action='next' then
   if (select paused from public.clinics where id=p_clinic) then raise exception 'Queue paused';end if;
   select id into current_id from public.appointments where clinic_id=p_clinic and status='inside';
   if current_id is distinct from p_expected then raise exception 'Queue changed; refresh first';end if;
   select id into next_id from public.appointments
   where clinic_id=p_clinic and status='waiting' and arrived and triage='approved'
     and (scheduled_at at time zone 'Africa/Cairo')::date=(now() at time zone 'Africa/Cairo')::date
     and scheduled_at<=now()+interval '15 minutes'
   order by priority desc,scheduled_at,id limit 1;
   if current_id is not null then update public.appointments set status='done',finished_at=now() where id=current_id;end if;
   if next_id is not null then update public.appointments set status='inside',started_at=now() where id=next_id;end if;
 else
   select * into a from public.appointments where id=p_appointment and clinic_id=p_clinic for update;
   if a.id is null then raise exception 'Appointment unavailable';end if;
   if p_action='arrive' and a.status='waiting' then update public.appointments set arrived=true where id=a.id;
   elsif p_action='approve' and role_name='doctor' and a.status='waiting' then update public.appointments set triage='approved' where id=a.id;
   elsif p_action='cancel' and a.status='waiting' and not a.paid then update public.appointments set status='cancelled' where id=a.id;
   elsif p_action='pay' and a.status<>'cancelled' and not a.paid then
     insert into public.payments(clinic_id,appointment_id,amount,method,received_by)
     values(p_clinic,a.id,a.price,a.payment_method,auth.uid());
     update public.appointments set paid=true where id=a.id;
   else raise exception 'Action not allowed for current state';end if;
 end if;
 insert into public.audit_log(clinic_id,actor,action,record_id)
 values(p_clinic,auth.uid(),p_action,p_appointment);
end$$;

create or replace function public.save_service(p_clinic uuid,p_service uuid,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare id_out uuid;
begin
 if private.role_for(p_clinic) is distinct from 'doctor' then raise exception 'Doctor only';end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 if p_service is null then
   insert into public.services(clinic_id,name,category,price,duration_minutes,priority,active)
   values(p_clinic,trim(p_data->>'name'),p_data->>'category',(p_data->>'price')::numeric,
          (p_data->>'duration_minutes')::int,(p_data->>'priority')::int,coalesce((p_data->>'active')::boolean,true))
   returning id into id_out;
 else
   update public.services set name=trim(p_data->>'name'),category=p_data->>'category',
     price=(p_data->>'price')::numeric,duration_minutes=(p_data->>'duration_minutes')::int,
     priority=(p_data->>'priority')::int,active=(p_data->>'active')::boolean
   where id=p_service and clinic_id=p_clinic returning id into id_out;
   if id_out is null then raise exception 'Service unavailable';end if;
 end if;
 insert into public.audit_log(clinic_id,actor,action,record_id)
 values(p_clinic,auth.uid(),'save_service',id_out);
 return id_out;
end$$;

create or replace function public.save_clinic(p_clinic uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if private.role_for(p_clinic) is distinct from 'doctor' then
   raise exception 'Doctor only' using errcode='42501';
 end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object'
   or length(trim(coalesce(p_data->>'name',''))) not between 2 and 100
   or length(coalesce(p_data->>'tagline',''))>180
   or length(coalesce(p_data->>'about',''))>4000
   or coalesce(p_data->>'photo_url','') !~ '^(https://|$)'
   or coalesce(p_data->>'accent','#087f7b') !~ '^#[0-9a-fA-F]{6}$'
   or coalesce(p_data->>'template','classic') not in ('classic','ocean','violet')
   or coalesce(p_data->>'buffer_minutes','') !~ '^([0-9]|[1-5][0-9]|60)$'
 then raise exception 'Invalid clinic profile';end if;
 if coalesce(p_data->>'latitude','')<>'' and
   (p_data->>'latitude') !~ '^-?([0-9]{1,2}(\.[0-9]+)?|90(\.0+)?)$'
 then raise exception 'Invalid latitude';end if;
 if coalesce(p_data->>'longitude','')<>'' and
   (p_data->>'longitude') !~ '^-?([0-9]{1,2}(\.[0-9]+)?|1[0-7][0-9](\.[0-9]+)?|180(\.0+)?)$'
 then raise exception 'Invalid longitude';end if;
 if nullif(p_data->>'latitude','') is not null and (p_data->>'latitude')::double precision not between -90 and 90 then raise exception 'Latitude is outside the allowed range';end if;
 if nullif(p_data->>'longitude','') is not null and (p_data->>'longitude')::double precision not between -180 and 180 then raise exception 'Longitude is outside the allowed range';end if;
 if (nullif(p_data->>'latitude','') is null)<>(nullif(p_data->>'longitude','') is null) then raise exception 'Latitude and longitude must be provided together';end if;
 if (p_data->>'opens')::time >= (p_data->>'closes')::time then raise exception 'Closing time must be after opening time';end if;
 update public.clinics set
   name=trim(p_data->>'name'),specialty=coalesce(trim(p_data->>'specialty'),''),
   address=coalesce(trim(p_data->>'address'),''),photo_url=nullif(p_data->>'photo_url',''),
   latitude=nullif(p_data->>'latitude','')::double precision,longitude=nullif(p_data->>'longitude','')::double precision,
   opens=(p_data->>'opens')::time,closes=(p_data->>'closes')::time,
   instapay=coalesce(trim(p_data->>'instapay'),''),wallet=coalesce(trim(p_data->>'wallet'),''),
   accent=coalesce(p_data->>'accent','#087f7b'),buffer_minutes=(p_data->>'buffer_minutes')::integer,
   tagline=trim(coalesce(p_data->>'tagline','')),about=trim(coalesce(p_data->>'about','')),
   template=coalesce(p_data->>'template','classic')
 where id=p_clinic;
 insert into public.audit_log(clinic_id,actor,action,record_id)
 values(p_clinic,auth.uid(),'save_clinic',p_clinic);
end$$;

create or replace function public.save_encounter(
 p_clinic uuid,p_appointment uuid,p_allergies text,p_history text,p_diagnosis text,p_notes text,p_medications jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.appointments;result uuid;m jsonb;
begin
 if private.role_for(p_clinic) is distinct from 'doctor' then raise exception 'Doctor only';end if;
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 select * into a from public.appointments where clinic_id=p_clinic and id=p_appointment and status in ('inside','done');
 if a.id is null or p_diagnosis is null or p_medications is null
   or length(trim(p_diagnosis)) not between 1 and 4000 or length(p_allergies)>4000 or length(p_history)>8000
   or length(p_notes)>8000 or jsonb_typeof(p_medications)<>'array' or jsonb_array_length(p_medications)>30
 then raise exception 'Invalid encounter';end if;
 for m in select value from jsonb_array_elements(p_medications) loop
   if coalesce(length(trim(m->>'name')),0) not between 1 and 120
    or coalesce(length(trim(m->>'dose')),0) not between 1 and 200
    or coalesce(length(trim(m->>'frequency')),0) not between 1 and 200
    or coalesce(length(trim(m->>'duration')),0) not between 1 and 200
    or not(m ?& array['name','dose','frequency','duration'])
   then raise exception 'Complete every medication field';end if;
 end loop;
 insert into public.medical_records(clinic_id,patient_id,allergies,history)
 values(p_clinic,a.patient_id,p_allergies,p_history)
 on conflict(clinic_id,patient_id) do update set allergies=excluded.allergies,history=excluded.history,updated_at=now();
 insert into public.encounters(clinic_id,patient_id,appointment_id,doctor_id,diagnosis,notes,medications)
 values(p_clinic,a.patient_id,a.id,auth.uid(),p_diagnosis,p_notes,p_medications) returning id into result;
 insert into public.audit_log(clinic_id,actor,action,record_id) values(p_clinic,auth.uid(),'save_encounter',result);
 return result;
end$$;

create or replace function public.generate_reminders()
returns int language plpgsql security definer set search_path='' as $$
declare c uuid;d date;eta jsonb;a record;n int=0;added int;
begin
 for c,d in
   select distinct a.clinic_id,(a.scheduled_at at time zone 'Africa/Cairo')::date
   from public.appointments a
   join public.clinics cl on cl.id=a.clinic_id
   where private.clinic_access_enabled(cl.id) and a.status in ('waiting','inside')
 loop
   eta=private.queue_estimates(c,d);
   for a in select * from public.appointments
     where clinic_id=c and (scheduled_at at time zone 'Africa/Cairo')::date=d
       and notification_consent and triage='approved' and status in ('waiting','inside')
   loop
     if (eta->a.id::text->>'minutes') is not null then
       if (eta->a.id::text->>'leaveIn')::int<=0 and a.status='waiting' then
         insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message)
         values(c,a.id,a.patient_id,'leave','موعدك اقترب. راجع الدور ووقت الطريق قبل التحرك.') on conflict do nothing;
         get diagnostics added=row_count;n=n+added;
       end if;
       if a.status='inside' then
         insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message)
         values(c,a.id,a.patient_id,'turn','حان دورك. توجّه إلى الاستقبال.') on conflict do nothing;
         get diagnostics added=row_count;n=n+added;
       end if;
     end if;
   end loop;
 end loop;
 return n;
end$$;

create or replace function public.claim_notifications()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with eligible as (
   select d.notification_id
   from public.notification_deliveries d
   join public.notifications n on n.id=d.notification_id
   join public.appointments a on a.id=n.appointment_id
   join public.clinics c on c.id=n.clinic_id
   where private.clinic_access_enabled(c.id) and d.state in ('pending','sending') and d.attempts<5
     and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now())
     and n.created_at>now()-interval '10 minutes' and not c.paused and a.notification_consent
     and ((n.kind='leave' and a.status='waiting' and not a.arrived) or (n.kind='turn' and a.status='inside'))
   order by n.created_at limit 20 for update of d skip locked
 ), claimed as (
   update public.notification_deliveries d
   set state='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid()
   from eligible e where d.notification_id=e.notification_id returning d.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',d.notification_id,'lease',d.lease_token,'phone',p.phone,'message',n.message)),'[]'::jsonb)
 into result
 from claimed d join public.notifications n on n.id=d.notification_id
 join public.patients p on (p.clinic_id,p.id)=(n.clinic_id,n.patient_id);
 return result;
end$$;

create or replace function private.can_manage_clinic_media(p_clinic_folder text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare clinic_id uuid;
begin
 if auth.uid() is null or p_clinic_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   return false;
 end if;
 clinic_id:=p_clinic_folder::uuid;
 return private.is_platform_admin_user((select auth.uid())) or (
   private.clinic_access_enabled(clinic_id) and exists(
     select 1 from public.memberships m
     where m.clinic_id=clinic_id and m.user_id=(select auth.uid()) and m.role='doctor'
   )
 );
exception when others then return false;
end$$;