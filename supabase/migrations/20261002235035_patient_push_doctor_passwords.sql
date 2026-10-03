begin;
-- Guest access is a high-entropy capability, never a phone lookup or Auth identity.
alter table public.appointments alter column requested_by drop not null;
create table public.booking_capabilities(
 clinic_id uuid not null references public.clinics, appointment_id uuid primary key,
 token_hash text unique not null check(token_hash ~ '^[0-9a-f]{64}$'),request_key uuid not null,
 expires_at timestamptz not null default now()+interval '31 days',
 foreign key(clinic_id,appointment_id) references public.appointments(clinic_id,id)
);
create table public.push_subscriptions(
 id uuid primary key default gen_random_uuid(),clinic_id uuid not null,appointment_id uuid not null,
 subscription jsonb not null,endpoint_hash text not null,created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '31 days',last_eta_key text,last_eta_at timestamptz,
 foreign key(clinic_id,appointment_id) references public.appointments(clinic_id,id),
 unique(appointment_id,endpoint_hash)
);
create table public.patient_request_limits(
 key_hash text primary key,window_start timestamptz not null,hits integer not null
);
create table public.doctor_password_requirements(
 user_id uuid primary key references auth.users on delete cascade,required boolean not null default true
);
alter table public.booking_capabilities enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.patient_request_limits enable row level security;
alter table public.doctor_password_requirements enable row level security;
-- Default-deny RLS. Only verified Edge Functions can access these tables; no browser grants.
revoke all on public.booking_capabilities,public.push_subscriptions,public.patient_request_limits,public.doctor_password_requirements from public,anon,authenticated;
grant all on public.booking_capabilities,public.push_subscriptions,public.patient_request_limits,public.doctor_password_requirements to service_role;
create index push_subscriptions_clinic_appointment_idx on public.push_subscriptions(clinic_id,appointment_id);
create function public.consume_patient_limit(p_key text,p_max int) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;
begin
 if p_key !~ '^[0-9a-f]{64}$' or p_max not between 1 and 100 then return false;end if;
 insert into public.patient_request_limits(key_hash,window_start,hits) values(p_key,now(),1)
 on conflict(key_hash) do update set hits=case when patient_request_limits.window_start<now()-interval '1 hour' then 1 else least(patient_request_limits.hits+1,101) end,
 window_start=case when patient_request_limits.window_start<now()-interval '1 hour' then now() else patient_request_limits.window_start end returning hits into n;
 return n<=p_max;
end$$;
create function public.doctor_password_status() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.doctor_password_requirements where user_id=auth.uid() and required)
$$;
create function private.password_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.encrypted_password is distinct from old.encrypted_password and coalesce(new.encrypted_password,'')<>'' then
  update public.doctor_password_requirements set required=false where user_id=new.id;
 end if;
 return new;
end$$;
create trigger clinic_doctor_password_changed after update of encrypted_password on auth.users for each row execute function private.password_changed();
create or replace function private.role_for(c uuid) returns text language sql stable security definer set search_path='' as $$
 select m.role from public.memberships m where m.clinic_id=c and m.user_id=auth.uid()
 and not exists(select 1 from public.doctor_password_requirements r where r.user_id=m.user_id and r.required)
$$;
-- Also gate direct medical-media authorization, which previously read memberships itself.
create or replace function private.can_manage_clinic_media(p_clinic_folder text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare clinic_id uuid;
begin
 if auth.uid() is null or p_clinic_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   return false;
 end if;
 clinic_id:=p_clinic_folder::uuid;
 return private.is_platform_admin_user((select auth.uid())) or (
   not public.doctor_password_status() and private.clinic_access_enabled(clinic_id) and exists(
     select 1 from public.memberships m
     where m.clinic_id=clinic_id and m.user_id=(select auth.uid()) and m.role='doctor'
   )
 );
exception when others then return false;
end$$;
create or replace function public.guest_book_appointment(
 p_clinic uuid,p_service uuid,p_name text,p_phone text,p_date date,p_time time,
 p_payment text,p_travel int,p_consent boolean,p_request uuid,p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;s public.services;p uuid;a public.appointments;t timestamptz;
begin
 if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 select * into a from public.appointments
 where clinic_id=p_clinic and id=(select appointment_id from public.booking_capabilities where clinic_id=p_clinic and token_hash=p_token_hash and request_key=p_request);
 if a.id is not null then return to_jsonb(a);end if;
 select * into c from public.clinics
 where id=p_clinic and published and private.clinic_access_enabled(id);
 select * into s from public.services where clinic_id=p_clinic and id=p_service and active;
 if c.id is null or s.id is null then raise exception 'Clinic or service unavailable';end if;
 if length(trim(p_name)) not between 3 and 80 or p_phone !~ '^01[0125][0-9]{8}$' then
   raise exception 'Invalid contact details';
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
 insert into public.patients(clinic_id,name,phone) values(p_clinic,trim(p_name),p_phone) returning id into p;
 insert into public.appointments(
   clinic_id,patient_id,service_id,requested_by,request_key,scheduled_at,
   service_name,price,duration_minutes,priority,category,triage,payment_method,
   travel_minutes,notification_consent
 ) values(
   p_clinic,p,s.id,null,p_request,t,s.name,s.price,s.duration_minutes,s.priority,
   s.category,case when s.category='emergency' then 'pending' else 'approved' end,
   p_payment,p_travel,p_consent
 ) returning * into a;
 insert into public.booking_capabilities(clinic_id,appointment_id,token_hash,request_key)
 values(p_clinic,a.id,p_token_hash,p_request);
 return to_jsonb(a);
end$$;

create or replace function public.clinic_snapshot(p_clinic uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text=private.role_for(p_clinic);result jsonb;eta jsonb='{}';d date;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if public.doctor_password_status() then raise exception 'Password change required';end if;
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
 if public.doctor_password_status() then raise exception 'Password change required';end if;
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

-- Use the existing notification queue for confirmation and ETA changes too.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('leave','turn','confirmation','eta'));
alter table public.notifications drop constraint notifications_appointment_id_kind_key;
alter table public.notifications add column dedupe_key text not null default '';
alter table public.notifications add unique(appointment_id,kind,dedupe_key);
alter function public.generate_reminders() rename to generate_legacy_reminders;
-- Fix the legacy record/SQL alias collision without changing an applied migration.
create or replace function public.generate_legacy_reminders()
returns int language plpgsql security definer set search_path='' as $$
declare c uuid;d date;eta jsonb;a public.appointments;n int=0;added int;
begin
 for c,d in select distinct q.clinic_id,(q.scheduled_at at time zone 'Africa/Cairo')::date
 from public.appointments q join public.clinics cl on cl.id=q.clinic_id
 where private.clinic_access_enabled(cl.id) and q.status in ('waiting','inside')
 loop
  eta=private.queue_estimates(c,d);
  for a in select * from public.appointments where clinic_id=c and (scheduled_at at time zone 'Africa/Cairo')::date=d
  and notification_consent and triage='approved' and status in ('waiting','inside')
  loop
   if (eta->a.id::text->>'minutes') is not null then
    if (eta->a.id::text->>'leaveIn')::int<=0 and a.status='waiting' then
     insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message) values(c,a.id,a.patient_id,'leave','موعدك اقترب. راجع الدور ووقت الطريق قبل التحرك.') on conflict do nothing;
     get diagnostics added=row_count;n=n+added;
    end if;
    if a.status='inside' then
     insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message) values(c,a.id,a.patient_id,'turn','حان دورك. توجّه إلى الاستقبال.') on conflict do nothing;
     get diagnostics added=row_count;n=n+added;
    end if;
   end if;
  end loop;
 end loop;
 return n;
end$$;
create function public.generate_reminders() returns int language plpgsql security definer set search_path='' as $$
declare s record;eta jsonb;k text;n int=0;
begin
 n=public.generate_legacy_reminders();
 for s in select distinct a.clinic_id,a.id,a.patient_id,a.status,a.scheduled_at from public.appointments a join public.push_subscriptions p on p.appointment_id=a.id
 where p.expires_at>now() and a.notification_consent and a.status in ('waiting','inside') and private.clinic_access_enabled(a.clinic_id)
 loop
  eta=private.queue_estimates(s.clinic_id,(s.scheduled_at at time zone 'Africa/Cairo')::date)->s.id::text;
  k=s.status||':'||coalesce(((eta->>'minutes')::int/5)::text,'unknown')||':'||(select paused::text from public.clinics where id=s.clinic_id);
  if exists(select 1 from public.push_subscriptions where appointment_id=s.id and last_eta_key is distinct from k and (last_eta_at is null or last_eta_at<now()-interval '10 minutes')) then
   insert into public.notifications(clinic_id,appointment_id,patient_id,kind,message,dedupe_key)
   values(s.clinic_id,s.id,s.patient_id,'eta',case when (eta->>'minutes') is null then 'تغيّر الدور. افتح العيادة لمراجعة الحالة؛ الوقت المتوقع غير متاح حاليًا.' else 'تحديث الدور: الدخول المتوقع خلال حوالي '||(eta->>'minutes')||' دقيقة. الوقت تقديري.' end,floor(extract(epoch from now())/600)::text) on conflict do nothing;
   update public.push_subscriptions set last_eta_key=k,last_eta_at=now() where appointment_id=s.id;
  end if;
 end loop;
 delete from public.patient_request_limits where window_start<now()-interval '2 days';
 delete from public.push_subscriptions where expires_at<now();
 return n;
end$$;
create or replace function public.claim_notifications() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 with eligible as (
 select d.notification_id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.appointments a on a.id=n.appointment_id
 where private.clinic_access_enabled(a.clinic_id) and a.notification_consent and d.state in ('pending','sending') and d.attempts<5 and d.next_attempt_at<=now()
 and (d.lease_until is null or d.lease_until<now()) and n.created_at>now()-interval '10 minutes'
 and (exists(select 1 from public.push_subscriptions s where s.appointment_id=a.id and s.expires_at>now()) or (a.requested_by is not null and n.kind in ('leave','turn')))
 and (n.kind in ('confirmation','eta') or (n.kind='turn' and a.status='inside') or (n.kind='leave' and a.status='waiting' and not a.arrived and not (select paused from public.clinics where id=a.clinic_id)))
 order by n.created_at limit 20 for update of d skip locked
 ),claimed as(update public.notification_deliveries d set state='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid() from eligible e where d.notification_id=e.notification_id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.notification_id,'lease',d.lease_token,'phone',p.phone,'message',n.message,'clinic_slug',c.slug,
 'channel',case when a.requested_by is null or exists(select 1 from public.push_subscriptions s where s.appointment_id=a.id) then 'push' else 'legacy' end,
 'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'subscription',s.subscription)) from public.push_subscriptions s where s.appointment_id=a.id and s.expires_at>now()),'[]'::jsonb))),'[]'::jsonb)
 into result from claimed d join public.notifications n on n.id=d.notification_id join public.appointments a on a.id=n.appointment_id join public.patients p on p.id=n.patient_id and p.clinic_id=n.clinic_id join public.clinics c on c.id=n.clinic_id;
 return result;
end$$;
revoke all on function public.guest_book_appointment(uuid,uuid,text,text,date,time,text,int,boolean,uuid,text),public.consume_patient_limit(text,int),public.generate_reminders(),public.doctor_password_status(),private.password_changed() from public,anon,authenticated;
grant execute on function public.guest_book_appointment(uuid,uuid,text,text,date,time,text,int,boolean,uuid,text),public.consume_patient_limit(text,int),public.generate_reminders() to service_role;
grant execute on function public.doctor_password_status() to authenticated;
create function public.guest_booking_eta(p_clinic uuid,p_appointment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments;
begin
 if not private.clinic_access_enabled(p_clinic) then raise exception 'Clinic unavailable';end if;
 select * into a from public.appointments where clinic_id=p_clinic and id=p_appointment;
 if a.id is null then raise exception 'Appointment unavailable';end if;
 return private.queue_estimates(p_clinic,(a.scheduled_at at time zone 'Africa/Cairo')::date)->a.id::text;
end$$;
revoke all on function public.guest_booking_eta(uuid,uuid) from public,anon,authenticated;
grant execute on function public.guest_booking_eta(uuid,uuid) to service_role;
commit;
