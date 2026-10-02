begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.clinics (
 id uuid primary key default gen_random_uuid(), slug text unique not null check(slug ~ '^[a-z0-9-]{3,80}$'),
 name text not null, specialty text not null default '', address text not null default '', photo_url text,
 latitude double precision check(latitude between -90 and 90), longitude double precision check(longitude between -180 and 180),
 accent text not null default '#087f7b' check(accent ~ '^#[0-9a-fA-F]{6}$'),
 opens time not null default '18:00', closes time not null default '21:00', check(closes>opens),
 paused boolean not null default false, buffer_minutes int not null default 5 check(buffer_minutes between 0 and 60),
 instapay text not null default '', wallet text not null default '', published boolean not null default false
);
-- Only provisioning by a trusted administrator can assign verified custom domains.
create table public.clinic_domains(hostname text primary key, clinic_id uuid not null references public.clinics, verified boolean not null default false);
create table public.memberships(clinic_id uuid not null references public.clinics, user_id uuid not null references auth.users, role text not null check(role in ('doctor','reception')),primary key(clinic_id,user_id));
create table public.services(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics,name text not null check(length(name) between 1 and 80),category text not null check(category in ('normal','urgent','emergency','followup')),price numeric(10,2) not null check(price between 0 and 100000),duration_minutes int not null check(duration_minutes between 5 and 180),priority int not null check(priority between 0 and 100),active boolean not null default true,unique(clinic_id,id));
create table public.patients(id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics,user_id uuid references auth.users,name text not null check(length(name) between 3 and 80),phone text not null check(phone ~ '^01[0125][0-9]{8}$'),created_at timestamptz not null default now(),unique(clinic_id,user_id),unique(clinic_id,id));
create table public.appointments(
 id uuid primary key default gen_random_uuid(),clinic_id uuid not null references public.clinics,patient_id uuid not null,service_id uuid not null,
 requested_by uuid not null references auth.users,request_key uuid not null, scheduled_at timestamptz not null,
 service_name text not null,price numeric(10,2) not null,duration_minutes int not null,priority int not null,
 category text not null,status text not null default 'waiting' check(status in ('waiting','inside','done','cancelled')),
 triage text not null default 'approved' check(triage in ('pending','approved')), arrived boolean not null default false,
 payment_method text not null check(payment_method in ('cash','instapay','wallet')),paid boolean not null default false,
 travel_minutes int not null default 30 check(travel_minutes between 0 and 240),notification_consent boolean not null default false,
 started_at timestamptz,finished_at timestamptz,created_at timestamptz not null default now(),
 foreign key(clinic_id,patient_id) references public.patients(clinic_id,id),foreign key(clinic_id,service_id) references public.services(clinic_id,id),
 unique(clinic_id,requested_by,request_key),unique(clinic_id,id),unique(clinic_id,id,patient_id)
);
create unique index one_current_visit on public.appointments(clinic_id) where status='inside';
create index queue_lookup on public.appointments(clinic_id,scheduled_at,status);
create table public.medical_records(id uuid primary key default gen_random_uuid(),clinic_id uuid not null,patient_id uuid not null,allergies text not null default '',history text not null default '',updated_at timestamptz not null default now(),foreign key(clinic_id,patient_id) references public.patients(clinic_id,id),unique(clinic_id,patient_id));
create table public.encounters(id uuid primary key default gen_random_uuid(),clinic_id uuid not null,patient_id uuid not null,appointment_id uuid not null,doctor_id uuid not null references auth.users,diagnosis text not null,notes text not null default '',medications jsonb not null default '[]' check(jsonb_typeof(medications)='array'),created_at timestamptz not null default now(),foreign key(clinic_id,appointment_id,patient_id) references public.appointments(clinic_id,id,patient_id));
create table public.payments(id uuid primary key default gen_random_uuid(),clinic_id uuid not null,appointment_id uuid not null,amount numeric(10,2) not null,method text not null,received_by uuid not null references auth.users,created_at timestamptz not null default now(),foreign key(clinic_id,appointment_id) references public.appointments(clinic_id,id),unique(appointment_id));
create table public.notifications(id uuid primary key default gen_random_uuid(),clinic_id uuid not null,appointment_id uuid not null,patient_id uuid not null,kind text not null check(kind in ('leave','turn')),message text not null,created_at timestamptz not null default now(),foreign key(clinic_id,appointment_id,patient_id) references public.appointments(clinic_id,id,patient_id),unique(appointment_id,kind));
create table public.audit_log(id bigint generated always as identity primary key,clinic_id uuid not null,actor uuid,action text not null,record_id uuid,created_at timestamptz not null default now());

create function private.role_for(c uuid) returns text language sql stable security definer set search_path='' as $$select role from public.memberships where clinic_id=c and user_id=(select auth.uid())$$;
create function private.owns_patient(c uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.patients where clinic_id=c and id=p and user_id=(select auth.uid()))$$;
revoke all on function private.role_for(uuid),private.owns_patient(uuid,uuid) from public;
grant execute on function private.role_for(uuid),private.owns_patient(uuid,uuid) to authenticated;

alter table public.clinics enable row level security;
alter table public.clinic_domains enable row level security;
alter table public.memberships enable row level security;
alter table public.services enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.medical_records enable row level security;
alter table public.encounters enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.clinics,public.clinic_domains,public.memberships,public.services,public.patients,public.appointments,public.medical_records,public.encounters,public.payments,public.notifications,public.audit_log from anon,authenticated;
grant select on public.clinics,public.services to anon,authenticated;
grant select on public.memberships,public.patients,public.appointments,public.medical_records,public.encounters,public.payments,public.notifications,public.audit_log to authenticated;
create policy public_clinic on public.clinics for select using(published or private.role_for(id) is not null);
create policy public_service on public.services for select using(exists(select 1 from public.clinics c where c.id=clinic_id and c.published) or private.role_for(clinic_id) is not null);
create policy own_membership on public.memberships for select to authenticated using(user_id=(select auth.uid()));
create policy contacts_scope on public.patients for select to authenticated using(private.role_for(clinic_id) is not null or user_id=(select auth.uid()));
create policy bookings_scope on public.appointments for select to authenticated using(private.role_for(clinic_id) is not null or private.owns_patient(clinic_id,patient_id));
-- Reception deliberately has no clinical read path, including Realtime.
create policy records_doctor on public.medical_records for select to authenticated using(private.role_for(clinic_id)='doctor');
create policy encounters_doctor on public.encounters for select to authenticated using(private.role_for(clinic_id)='doctor');
create policy receipts_staff on public.payments for select to authenticated using(private.role_for(clinic_id) is not null);
create policy notices_scope on public.notifications for select to authenticated using(private.role_for(clinic_id) is not null or private.owns_patient(clinic_id,patient_id));
create policy audit_doctor on public.audit_log for select to authenticated using(private.role_for(clinic_id)='doctor');

create function public.resolve_clinic(p_host text,p_slug text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;
begin
 select cl.* into c from public.clinics cl join public.clinic_domains d on d.clinic_id=cl.id where d.hostname=lower(p_host) and d.verified and cl.published;
 if c.id is null then select * into c from public.clinics where slug=p_slug and published;end if;
 if c.id is null then raise exception 'Clinic unavailable';end if;
 return jsonb_build_object('clinic',to_jsonb(c),'services',(select coalesce(jsonb_agg(s order by s.priority),'[]'::jsonb) from public.services s where clinic_id=c.id and active));
end$$;

create function private.queue_estimates(c uuid,d date) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb='{}';cursor_at timestamptz=now();r public.appointments;done_ids uuid[]='{}';duration numeric;mins int;is_paused boolean;buf int;
begin
 select paused,buffer_minutes into is_paused,buf from public.clinics where id=c;
 if is_paused then return '{}'::jsonb;end if;
 select * into r from public.appointments where clinic_id=c and status='inside';
 if r.id is not null then cursor_at=now()+greatest(3,r.duration_minutes-extract(epoch from(now()-r.started_at))/60)*interval '1 minute';result=result||jsonb_build_object(r.id,jsonb_build_object('minutes',0,'low',0,'high',0));end if;
 loop
  select * into r from public.appointments where clinic_id=c and status='waiting' and triage='approved' and (scheduled_at at time zone 'Africa/Cairo')::date=d and not(id=any(done_ids)) order by greatest(scheduled_at,cursor_at),priority desc,scheduled_at,id limit 1;
  exit when r.id is null;
  cursor_at=greatest(cursor_at,r.scheduled_at);mins=greatest(0,ceil(extract(epoch from(cursor_at-now()))/60));
  result=result||jsonb_build_object(r.id,jsonb_build_object('minutes',mins,'low',greatest(0,mins-buf),'high',mins+buf,'leaveIn',greatest(0,mins-r.travel_minutes-buf),'expectedAt',cursor_at));
  select case when count(*)>=3 then greatest(r.duration_minutes*.5,least(r.duration_minutes*3,avg(v.minutes))) else r.duration_minutes end into duration from(select extract(epoch from(finished_at-started_at))/60 minutes from public.appointments where clinic_id=c and service_id=r.service_id and status='done' and finished_at>started_at and extract(epoch from(finished_at-started_at))/60 between 1 and 240 order by finished_at desc limit 20)v;
  cursor_at=cursor_at+duration*interval '1 minute';done_ids=array_append(done_ids,r.id);
 end loop;
 return result;
end$$;

create function public.clinic_snapshot(p_clinic uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text=private.role_for(p_clinic);result jsonb;eta jsonb='{}';d date;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 for d in select distinct (scheduled_at at time zone 'Africa/Cairo')::date from public.appointments where clinic_id=p_clinic and status in ('waiting','inside') loop eta=eta||private.queue_estimates(p_clinic,d);end loop;
 select jsonb_build_object('role',coalesce(role_name,'patient'),'bookings',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('name',p.name,'phone',p.phone,'eta',eta->a.id::text) order by a.scheduled_at) from public.appointments a join public.patients p on (p.clinic_id,p.id)=(a.clinic_id,a.patient_id) where a.clinic_id=p_clinic and (role_name is not null or p.user_id=auth.uid()) and a.scheduled_at>now()-interval '30 days'),'[]'::jsonb),'notifications',coalesce((select jsonb_agg(n) from public.notifications n where clinic_id=p_clinic and (role_name is not null or private.owns_patient(p_clinic,n.patient_id)) and created_at>now()-interval '7 days'),'[]'::jsonb)) into result;
 return result;
end$$;

create function public.book_appointment(p_clinic uuid,p_service uuid,p_name text,p_phone text,p_date date,p_time time,p_payment text,p_travel int,p_consent boolean,p_request uuid,p_patient uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;s public.services;p uuid;a public.appointments;t timestamptz;role_name text=private.role_for(p_clinic);verified_phone text;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 select * into a from public.appointments where clinic_id=p_clinic and requested_by=auth.uid() and request_key=p_request;
 if a.id is not null then return to_jsonb(a);end if;
 select * into c from public.clinics where id=p_clinic and published;
 select * into s from public.services where clinic_id=p_clinic and id=p_service and active;
 if c.id is null or s.id is null then raise exception 'Clinic or service unavailable';end if;
 if length(trim(p_name)) not between 3 and 80 or p_phone !~ '^01[0125][0-9]{8}$' then raise exception 'Invalid contact details';end if;
 if role_name is null then
  select phone into verified_phone from auth.users where id=auth.uid() and phone_confirmed_at is not null;
  if verified_phone is null or regexp_replace(verified_phone,'^\+','')<>'20'||substring(p_phone from 2) then raise exception 'Verify your phone before booking';end if;
  if (select count(*) from public.appointments where requested_by=auth.uid() and created_at>now()-interval '1 hour')>=5 then raise exception 'Booking limit reached';end if;
 end if;
 if p_date<(now() at time zone 'Africa/Cairo')::date or p_date>(now() at time zone 'Africa/Cairo')::date+30 then raise exception 'Date outside booking window';end if;
 t=(p_date+p_time) at time zone 'Africa/Cairo';
 if t<now() or p_time<c.opens or p_time+s.duration_minutes*interval '1 minute'>c.closes then raise exception 'Outside clinic hours';end if;
 if exists(select 1 from public.appointments where clinic_id=p_clinic and status<>'cancelled' and tstzrange(scheduled_at,scheduled_at+duration_minutes*interval '1 minute','[)') && tstzrange(t,t+s.duration_minutes*interval '1 minute','[)')) then raise exception 'Slot unavailable';end if;
 if p_payment='instapay' and c.instapay='' or p_payment='wallet' and c.wallet='' then raise exception 'Payment method unavailable';end if;
 if role_name is null then
  insert into public.patients(clinic_id,user_id,name,phone) values(p_clinic,auth.uid(),trim(p_name),p_phone) on conflict(clinic_id,user_id) do update set name=excluded.name,phone=excluded.phone returning id into p;
 else
  -- Existing contacts must be explicitly selected by tenant-authorized staff.
  if p_patient is not null then
   select id into p from public.patients where id=p_patient and clinic_id=p_clinic;
   if p is null then raise exception 'Patient unavailable';end if;
  else
   insert into public.patients(clinic_id,name,phone) values(p_clinic,trim(p_name),p_phone) returning id into p;
  end if;
 end if;
 insert into public.appointments(clinic_id,patient_id,service_id,requested_by,request_key,scheduled_at,service_name,price,duration_minutes,priority,category,triage,payment_method,travel_minutes,notification_consent) values(p_clinic,p,s.id,auth.uid(),p_request,t,s.name,s.price,s.duration_minutes,s.priority,s.category,case when s.category='emergency' then 'pending' else 'approved' end,p_payment,p_travel,p_consent) returning * into a;
 return to_jsonb(a);
end$$;

create function public.save_service(p_clinic uuid,p_service uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare id_out uuid;
begin
 if private.role_for(p_clinic) is distinct from 'doctor' then raise exception 'Doctor only';end if;
 if p_service is null then
 insert into public.services(clinic_id,name,category,price,duration_minutes,priority,active) values(p_clinic,trim(p_data->>'name'),p_data->>'category',(p_data->>'price')::numeric,(p_data->>'duration_minutes')::int,(p_data->>'priority')::int,coalesce((p_data->>'active')::boolean,true)) returning id into id_out;
 else
 update public.services set name=trim(p_data->>'name'),category=p_data->>'category',price=(p_data->>'price')::numeric,duration_minutes=(p_data->>'duration_minutes')::int,priority=(p_data->>'priority')::int,active=(p_data->>'active')::boolean where id=p_service and clinic_id=p_clinic returning id into id_out;
 if id_out is null then raise exception 'Service unavailable';end if;
 end if;
 insert into public.audit_log(clinic_id,actor,action,record_id) values(p_clinic,auth.uid(),'save_service',id_out);return id_out;
end$$;

create function public.save_clinic(p_clinic uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 if private.role_for(p_clinic) is distinct from 'doctor' then raise exception 'Doctor only';end if;
 if length(p_data->>'name') not between 2 and 100 or coalesce(p_data->>'photo_url','') !~ '^(https://|$)' then raise exception 'Invalid clinic profile';end if;
 update public.clinics set name=p_data->>'name',specialty=p_data->>'specialty',address=p_data->>'address',photo_url=nullif(p_data->>'photo_url',''),latitude=nullif(p_data->>'latitude','')::float,longitude=nullif(p_data->>'longitude','')::float,opens=(p_data->>'opens')::time,closes=(p_data->>'closes')::time,instapay=p_data->>'instapay',wallet=p_data->>'wallet',accent=p_data->>'accent',buffer_minutes=(p_data->>'buffer_minutes')::int where id=p_clinic;
 insert into public.audit_log(clinic_id,actor,action,record_id) values(p_clinic,auth.uid(),'save_clinic',p_clinic);
end$$;

create function public.staff_action(p_clinic uuid,p_action text,p_appointment uuid default null,p_expected uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare role_name text=private.role_for(p_clinic);a public.appointments;current_id uuid;next_id uuid;
begin
 if role_name is null then raise exception 'Staff only';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 if p_action in ('pause','resume') then update public.clinics set paused=(p_action='pause') where id=p_clinic;
 elsif p_action='next' then
  if (select paused from public.clinics where id=p_clinic) then raise exception 'Queue paused';end if;
  select id into current_id from public.appointments where clinic_id=p_clinic and status='inside';
  if current_id is distinct from p_expected then raise exception 'Queue changed; refresh first';end if;
  select id into next_id from public.appointments where clinic_id=p_clinic and status='waiting' and arrived and triage='approved' and (scheduled_at at time zone 'Africa/Cairo')::date=(now() at time zone 'Africa/Cairo')::date and scheduled_at<=now()+interval '15 minutes' order by priority desc,scheduled_at,id limit 1;
  if current_id is not null then update public.appointments set status='done',finished_at=now() where id=current_id;end if;
  if next_id is not null then update public.appointments set status='inside',started_at=now() where id=next_id;end if;
 else
  select * into a from public.appointments where id=p_appointment and clinic_id=p_clinic for update;
  if a.id is null then raise exception 'Appointment unavailable';end if;
  if p_action='arrive' and a.status='waiting' then update public.appointments set arrived=true where id=a.id;
  elsif p_action='approve' and role_name='doctor' and a.status='waiting' then update public.appointments set triage='approved' where id=a.id;
  elsif p_action='cancel' and a.status='waiting' and not a.paid then update public.appointments set status='cancelled' where id=a.id;
  elsif p_action='pay' and a.status<>'cancelled' and not a.paid then
   insert into public.payments(clinic_id,appointment_id,amount,method,received_by) values(p_clinic,a.id,a.price,a.payment_method,auth.uid());update public.appointments set paid=true where id=a.id;
  else raise exception 'Action not allowed for current state';end if;
 end if;
 insert into public.audit_log(clinic_id,actor,action,record_id) values(p_clinic,auth.uid(),p_action,p_appointment);
end$$;

create function public.save_encounter(p_clinic uuid,p_appointment uuid,p_allergies text,p_history text,p_diagnosis text,p_notes text,p_medications jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.appointments;result uuid;m jsonb;
begin
 if private.role_for(p_clinic) is distinct from 'doctor' then raise exception 'Doctor only';end if;
 select * into a from public.appointments where clinic_id=p_clinic and id=p_appointment and status in ('inside','done');
 if a.id is null or p_diagnosis is null or p_medications is null or length(trim(p_diagnosis)) not between 1 and 4000 or length(p_allergies)>4000 or length(p_history)>8000 or length(p_notes)>8000 or jsonb_typeof(p_medications)<>'array' or jsonb_array_length(p_medications)>30 then raise exception 'Invalid encounter';end if;
 for m in select value from jsonb_array_elements(p_medications) loop
 if coalesce(length(trim(m->>'name')),0) not between 1 and 120 or coalesce(length(trim(m->>'dose')),0) not between 1 and 200 or coalesce(length(trim(m->>'frequency')),0) not between 1 and 200 or coalesce(length(trim(m->>'duration')),0) not between 1 and 200 or not(m ?& array['name','dose','frequency','duration']) then raise exception 'Complete every medication field';end if;end loop;
 insert into public.medical_records(clinic_id,patient_id,allergies,history) values(p_clinic,a.patient_id,p_allergies,p_history) on conflict(clinic_id,patient_id) do update set allergies=excluded.allergies,history=excluded.history,updated_at=now();
 insert into public.encounters(clinic_id,patient_id,appointment_id,doctor_id,diagnosis,notes,medications) values(p_clinic,a.patient_id,a.id,auth.uid(),p_diagnosis,p_notes,p_medications) returning id into result;
 insert into public.audit_log(clinic_id,actor,action,record_id) values(p_clinic,auth.uid(),'save_encounter',result);return result;
end$$;

-- Durable in-app reminders. Run every minute via pg_cron; no external messages sent.
create function public.generate_reminders() returns int language plpgsql security definer set search_path='' as $$
declare c uuid;d date;eta jsonb;a record;n int=0;added int;
begin
 for c,d in select distinct clinic_id,(scheduled_at at time zone 'Africa/Cairo')::date from public.appointments where status in ('waiting','inside') loop
 eta=private.queue_estimates(c,d);
 for a in select * from public.appointments where clinic_id=c and (scheduled_at at time zone 'Africa/Cairo')::date=d and notification_consent and triage='approved' and status in ('waiting','inside') loop
 if (eta->a.id::text->>'minutes') is not null then
 if (eta->a.id::text->>'leaveIn')::int<=0 and a.status='waiting' then insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message) values(c,a.id,a.patient_id,'leave','موعدك اقترب. راجع الدور ووقت الطريق قبل التحرك.') on conflict do nothing;get diagnostics added=row_count;n=n+added;end if;
 if a.status='inside' then insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message) values(c,a.id,a.patient_id,'turn','حان دورك. توجّه إلى الاستقبال.') on conflict do nothing;get diagnostics added=row_count;n=n+added;end if;
 end if;
 end loop;end loop;return n;
end$$;

revoke all on function private.queue_estimates(uuid,date) from public,anon,authenticated;
revoke all on function public.resolve_clinic(text,text),public.clinic_snapshot(uuid),public.book_appointment(uuid,uuid,text,text,date,time,text,int,boolean,uuid,uuid),public.save_service(uuid,uuid,jsonb),public.save_clinic(uuid,jsonb),public.staff_action(uuid,text,uuid,uuid),public.save_encounter(uuid,uuid,text,text,text,text,jsonb),public.generate_reminders() from public,anon,authenticated;
grant execute on function public.resolve_clinic(text,text) to anon,authenticated;
grant execute on function public.clinic_snapshot(uuid),public.book_appointment(uuid,uuid,text,text,date,time,text,int,boolean,uuid,uuid),public.save_service(uuid,uuid,jsonb),public.save_clinic(uuid,jsonb),public.staff_action(uuid,text,uuid,uuid),public.save_encounter(uuid,uuid,text,text,text,text,jsonb) to authenticated;
grant execute on function public.generate_reminders() to service_role;
-- Realtime SELECT checks use the RLS policies above; medical tables are not published.
alter publication supabase_realtime add table public.appointments,public.notifications,public.clinics,public.services;
commit;
