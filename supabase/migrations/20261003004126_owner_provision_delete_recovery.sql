-- Extend the existing owner RPCs atomically. Do not edit applied migrations.
begin;
CREATE OR REPLACE FUNCTION public.platform_admin_create_tenant(p_admin_user_id uuid, p_doctor_user_id uuid, p_data jsonb, p_services jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  created_clinic public.clinics;
  doctor_email text;
  service jsonb;
  service_id uuid;
  service_total int;
begin
  if not private.is_platform_admin_user(p_admin_user_id) then
    raise exception 'Platform administrator required' using errcode='42501';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Invalid clinic details';
  end if;
  if p_services is null or jsonb_typeof(p_services) <> 'array' then
    raise exception 'At least one clinic service is required';
  end if;
  service_total := jsonb_array_length(p_services);
  if service_total < 1 or service_total > 20 then
    raise exception 'A clinic must have between 1 and 20 services';
  end if;
  if coalesce(p_data->>'slug','') !~ '^[a-z0-9-]{3,80}$' then
    raise exception 'Clinic URL must use 3–80 lowercase letters, numbers, or hyphens';
  end if;
  if length(trim(coalesce(p_data->>'name',''))) not between 2 and 100 then
    raise exception 'Clinic name must be between 2 and 100 characters';
  end if;
  if length(trim(coalesce(p_data->>'doctor_email',''))) > 254
     or coalesce(p_data->>'doctor_email','') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Doctor email is invalid';
  end if;
  if coalesce(p_data->>'accent','#087f7b') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Brand color must be a six digit hex color';
  end if;
  if coalesce(p_data->>'photo_url','') <> '' and p_data->>'photo_url' !~ '^https://' then
    raise exception 'Doctor photo URL must use HTTPS';
  end if;
  if coalesce(p_data->>'latitude','') <> '' and coalesce(p_data->>'latitude','') !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'Latitude is invalid';
  end if;
  if coalesce(p_data->>'longitude','') <> '' and coalesce(p_data->>'longitude','') !~ '^-?[0-9]+(\.[0-9]+)?$' then
    raise exception 'Longitude is invalid';
  end if;
  if not exists (select 1 from auth.users au where au.id=p_doctor_user_id) then
    raise exception 'Doctor invitation could not be created';
  end if;
  select au.email into doctor_email from auth.users au where au.id=p_doctor_user_id;
  if lower(coalesce(doctor_email,'')) <> lower(p_data->>'doctor_email') then
    raise exception 'Doctor email does not match the invited account';
  end if;
  if exists (select 1 from public.clinics c where c.slug=p_data->>'slug') then
    raise exception 'Clinic URL is already in use';
  end if;

  for service in select value from jsonb_array_elements(p_services)
  loop
    if length(trim(coalesce(service->>'name',''))) not between 1 and 80
       or coalesce(service->>'category','') not in ('normal','urgent','emergency','followup')
       or coalesce(service->>'price','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
       or coalesce(service->>'duration_minutes','') !~ '^[0-9]{1,3}$'
       or coalesce(service->>'priority','') !~ '^[0-9]{1,3}$' then
      raise exception 'A clinic service has invalid details';
    end if;
    if (service->>'price')::numeric > 100000
       or (service->>'duration_minutes')::int not between 5 and 180
       or (service->>'priority')::int not between 0 and 100 then
      raise exception 'A clinic service is outside allowed limits';
    end if;
  end loop;

  insert into public.clinics (
    slug,name,specialty,address,photo_url,latitude,longitude,accent,
    opens,closes,buffer_minutes,instapay,wallet,published
  )
  values (
    p_data->>'slug',
    trim(p_data->>'name'),
    coalesce(trim(p_data->>'specialty'),''),
    coalesce(trim(p_data->>'address'),''),
    nullif(p_data->>'photo_url',''),
    nullif(p_data->>'latitude','')::double precision,
    nullif(p_data->>'longitude','')::double precision,
    coalesce(p_data->>'accent','#087f7b'),
    coalesce(p_data->>'opens','18:00')::time,
    coalesce(p_data->>'closes','21:00')::time,
    coalesce((p_data->>'buffer_minutes')::int,5),
    coalesce(p_data->>'instapay',''),
    coalesce(p_data->>'wallet',''),
    true
  )
  returning * into created_clinic;

  insert into public.memberships(clinic_id,user_id,role)
  values(created_clinic.id,p_doctor_user_id,'doctor');

  for service in select value from jsonb_array_elements(p_services)
  loop
    insert into public.services(clinic_id,name,category,price,duration_minutes,priority,active)
    values(
      created_clinic.id,
      trim(service->>'name'),
      service->>'category',
      (service->>'price')::numeric,
      (service->>'duration_minutes')::int,
      (service->>'priority')::int,
      coalesce((service->>'active')::boolean,true)
    )
    returning id into service_id;
  end loop;

  insert into public.audit_log(clinic_id,actor,action,record_id)
  values(created_clinic.id,p_admin_user_id,'platform_tenant_created',created_clinic.id);

  return jsonb_build_object(
    'id',created_clinic.id,
    'slug',created_clinic.slug,
    'name',created_clinic.name,
    'doctor_email',doctor_email,
    'service_count',service_total,
    'published',created_clinic.published
  );
end
$function$;


CREATE OR REPLACE FUNCTION public.platform_admin_create_tenant_pending(p_admin_user_id uuid, p_doctor_user_id uuid, p_data jsonb, p_services jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tenant jsonb;
  clinic_id uuid;
begin
  if not private.is_platform_admin_user(p_admin_user_id) then
    raise exception 'Platform administrator required' using errcode='42501';
  end if;

  insert into public.doctor_password_requirements(user_id,required)
    values(p_doctor_user_id,true) on conflict(user_id) do update set required=true;
  tenant := public.platform_admin_create_tenant(p_admin_user_id,p_doctor_user_id,p_data,p_services);
  clinic_id := (tenant->>'id')::uuid;

  update public.clinics set is_active=false where id=clinic_id;
  if not found then raise exception 'Created clinic unavailable'; end if;
  update public.clinics set tagline=coalesce(p_data->>'tagline',''),about=coalesce(p_data->>'about',''),
    template=coalesce(p_data->>'template','classic') where id=clinic_id;

  insert into public.doctor_activation_requests(
    clinic_id,doctor_user_id,doctor_email,doctor_name,requested_by
  ) values (
    clinic_id,p_doctor_user_id,lower(trim(p_data->>'doctor_email')),
    trim(p_data->>'doctor_name'),p_admin_user_id
  );

  return tenant || jsonb_build_object('activation_status','pending');
end;
$function$;


CREATE OR REPLACE FUNCTION public.platform_admin_update_clinic(p_admin_user_id uuid, p_clinic_id uuid, p_data jsonb, p_services jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  service jsonb;
  service_id uuid;
  service_ids uuid[] := array[]::uuid[];
  service_count integer;
  active_count integer := 0;
  updated_count integer;
begin
  if not private.is_platform_admin_user(p_admin_user_id) then
    raise exception 'Platform administrator required' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object'
     or p_services is null or jsonb_typeof(p_services) <> 'array' then
    raise exception 'Invalid clinic details';
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic_id) then
    raise exception 'Clinic unavailable';
  end if;
  service_count := jsonb_array_length(p_services);
  if service_count < 1 or service_count > 20 then
    raise exception 'A clinic must have between 1 and 20 services';
  end if;
  if coalesce(p_data->>'slug', '') !~ '^[a-z0-9-]{3,80}$'
     or length(trim(coalesce(p_data->>'name', ''))) not between 2 and 100
     or length(coalesce(p_data->>'tagline', '')) > 180
     or length(coalesce(p_data->>'about', '')) > 4000
     or coalesce(p_data->>'accent', '#087f7b') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(p_data->>'template', 'classic') not in ('classic', 'ocean', 'violet')
     or coalesce(p_data->>'photo_url', '') !~ '^(https://|$)'
     or coalesce(p_data->>'buffer_minutes', '') !~ '^([0-9]|[1-5][0-9]|60)$' then
    raise exception 'Invalid clinic profile';
  end if;
  if coalesce(p_data->>'latitude', '') <> '' and
     (p_data->>'latitude') !~ '^-?([0-9]{1,2}(\.[0-9]+)?|90(\.0+)?)$' then
    raise exception 'Invalid latitude';
  end if;
  if coalesce(p_data->>'longitude', '') <> '' and
     (p_data->>'longitude') !~ '^-?([0-9]{1,2}(\.[0-9]+)?|1[0-7][0-9](\.[0-9]+)?|180(\.0+)?)$' then
    raise exception 'Invalid longitude';
  end if;
  if nullif(p_data->>'latitude', '') is not null and (p_data->>'latitude')::double precision not between -90 and 90 then
    raise exception 'Latitude is outside the allowed range';
  end if;
  if nullif(p_data->>'longitude', '') is not null and (p_data->>'longitude')::double precision not between -180 and 180 then
    raise exception 'Longitude is outside the allowed range';
  end if;
  if (nullif(p_data->>'latitude', '') is null) <> (nullif(p_data->>'longitude', '') is null) then
    raise exception 'Latitude and longitude must be provided together';
  end if;
  if (p_data->>'opens')::time >= (p_data->>'closes')::time then
    raise exception 'Closing time must be after opening time';
  end if;

  update public.clinics set
    slug = p_data->>'slug',
    name = trim(p_data->>'name'),
    specialty = coalesce(trim(p_data->>'specialty'), ''),
    address = coalesce(trim(p_data->>'address'), ''),
    photo_url = nullif(p_data->>'photo_url', ''),
    latitude = nullif(p_data->>'latitude', '')::double precision,
    longitude = nullif(p_data->>'longitude', '')::double precision,
    accent = coalesce(p_data->>'accent', '#087f7b'),
    opens = (p_data->>'opens')::time,
    closes = (p_data->>'closes')::time,
    instapay = coalesce(trim(p_data->>'instapay'), ''),
    wallet = coalesce(trim(p_data->>'wallet'), ''),
    buffer_minutes = (p_data->>'buffer_minutes')::integer,
    tagline = trim(coalesce(p_data->>'tagline', '')),
    about = trim(coalesce(p_data->>'about', '')),
    template = coalesce(p_data->>'template', 'classic')
  where id = p_clinic_id;

  for service in select value from jsonb_array_elements(p_services)
  loop
    if length(trim(coalesce(service->>'name', ''))) not between 1 and 80
       or coalesce(service->>'category', '') not in ('normal', 'urgent', 'emergency', 'followup')
       or coalesce(service->>'price', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
       or coalesce(service->>'duration_minutes', '') !~ '^[0-9]{1,3}$'
       or coalesce(service->>'priority', '') !~ '^[0-9]{1,3}$'
       or coalesce(service->>'active', 'true') not in ('true', 'false') then
      raise exception 'A clinic service has invalid details';
    end if;
    if (service->>'price')::numeric > 100000
       or (service->>'duration_minutes')::integer not between 5 and 180
       or (service->>'priority')::integer not between 0 and 100 then
      raise exception 'A clinic service is outside allowed limits';
    end if;

    service_id := null;
    if nullif(service->>'id', '') is not null then
      if (service->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Invalid service id';
      end if;
      service_id := (service->>'id')::uuid;
      update public.services set
        name = trim(service->>'name'), category = service->>'category',
        price = (service->>'price')::numeric,
        duration_minutes = (service->>'duration_minutes')::integer,
        priority = (service->>'priority')::integer,
        active = (service->>'active')::boolean
      where id = service_id and clinic_id = p_clinic_id;
      get diagnostics updated_count = row_count;
      if updated_count = 0 then raise exception 'Service does not belong to this clinic'; end if;
    else
      insert into public.services(clinic_id, name, category, price, duration_minutes, priority, active)
      values(p_clinic_id, trim(service->>'name'), service->>'category',
        (service->>'price')::numeric, (service->>'duration_minutes')::integer,
        (service->>'priority')::integer, (service->>'active')::boolean)
      returning id into service_id;
    end if;
    service_ids := array_append(service_ids, service_id);
    if (service->>'active')::boolean then active_count := active_count + 1; end if;
  end loop;

  if active_count = 0 then raise exception 'At least one service must remain active'; end if;
  update public.services set active = false
  where clinic_id = p_clinic_id and not (id = any(service_ids));

  insert into public.audit_log(clinic_id, actor, action, record_id)
  values(p_clinic_id, p_admin_user_id, 'platform_admin_customized_clinic', p_clinic_id);
end
$function$;


create table public.owner_provision_operations(
 id uuid primary key,owner_id uuid not null references auth.users,doctor_user_id uuid not null unique default gen_random_uuid(),
 clinic_slug text not null,doctor_email text not null,clinic_id uuid references public.clinics on delete set null,
 state text not null default 'prepared' check(state in ('prepared','completed','cleanup_required','failed')),
 lease_until timestamptz not null default now()+interval '2 minutes',lease_token uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index owner_provision_slug_reservation on public.owner_provision_operations(clinic_slug) where state in ('prepared','cleanup_required');
create table public.owner_deletion_receipts(
 id uuid primary key,owner_id uuid not null references auth.users,clinic_id uuid not null,
 confirmation_name text not null,confirmation_slug text not null,storage_paths jsonb not null default '[]',
 media_deleted boolean not null default false,created_at timestamptz not null default now()
);
alter table public.owner_provision_operations enable row level security;
alter table public.owner_deletion_receipts enable row level security;
revoke all on public.owner_provision_operations,public.owner_deletion_receipts from public,anon,authenticated;
grant all on public.owner_provision_operations,public.owner_deletion_receipts to service_role;

create function private.validate_owner_create(p_data jsonb,p_services jsonb) returns void language plpgsql set search_path='' as $$
declare s jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_services) is distinct from 'array' then raise exception 'Invalid clinic details';end if;
 if jsonb_array_length(p_services) not between 1 and 20 or coalesce(p_data->>'slug','') !~ '^[a-z0-9-]{3,80}$'
 or length(trim(coalesce(p_data->>'name',''))) not between 2 and 100
 or length(trim(coalesce(p_data->>'doctor_name',''))) not between 2 and 100
 or length(coalesce(p_data->>'doctor_email',''))>254 or coalesce(p_data->>'doctor_email','') !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
 or length(coalesce(p_data->>'tagline',''))>180 or length(coalesce(p_data->>'about',''))>4000
 or coalesce(p_data->>'template','classic') not in ('classic','ocean','violet')
 or coalesce(p_data->>'accent','#087f7b') !~ '^#[0-9a-fA-F]{6}$'
 or coalesce(p_data->>'photo_url','') !~ '^(https://|$)'
 or coalesce(p_data->>'buffer_minutes','5') !~ '^([0-9]|[1-5][0-9]|60)$'
 then raise exception 'Invalid clinic details';end if;
 if coalesce(p_data->>'opens','18:00')::time>=coalesce(p_data->>'closes','21:00')::time then raise exception 'Invalid clinic hours';end if;
 if (nullif(p_data->>'latitude','') is null)<>(nullif(p_data->>'longitude','') is null) then raise exception 'Invalid coordinates';end if;
 if nullif(p_data->>'latitude','') is not null and ((p_data->>'latitude')::float8 not between -90 and 90 or (p_data->>'longitude')::float8 not between -180 and 180) then raise exception 'Invalid coordinates';end if;
 for s in select value from jsonb_array_elements(p_services) loop
  if length(trim(coalesce(s->>'name',''))) not between 1 and 80 or coalesce(s->>'category','') not in ('normal','urgent','emergency','followup')
  or coalesce(s->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$' or coalesce(s->>'duration_minutes','') !~ '^[0-9]{1,3}$' or coalesce(s->>'priority','') !~ '^[0-9]{1,3}$'
  or coalesce(s->>'active','true') not in ('true','false') then raise exception 'Invalid service details';end if;
  if (s->>'price')::numeric>100000 or (s->>'duration_minutes')::int not between 5 and 180 or (s->>'priority')::int not between 0 and 100 then raise exception 'Invalid service details';end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(p_services) item where coalesce((item->>'active')::boolean,true)) then raise exception 'At least one active service required';end if;
end$$;
revoke all on function private.validate_owner_create(jsonb,jsonb) from public,anon,authenticated;

create function public.owner_prepare_tenant(p_owner uuid,p_request uuid,p_data jsonb,p_services jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.owner_provision_operations;
begin
 if not private.is_platform_admin_user(p_owner) then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform private.validate_owner_create(p_data,p_services);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into op from public.owner_provision_operations where id=p_request for update;
 if op.id is not null then
  if op.owner_id<>p_owner or op.clinic_slug<>p_data->>'slug' or op.doctor_email<>lower(trim(p_data->>'doctor_email')) then raise exception 'Request details changed';end if;
  if op.state='completed' then return to_jsonb(op);end if;
  if op.state='failed' then raise exception 'Use a new request';end if;
  if op.lease_until>now() then raise exception 'Operation in progress';end if;
  update public.owner_provision_operations set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() where id=op.id returning * into op;
  return to_jsonb(op);
 end if;
 if exists(select 1 from public.clinics where slug=p_data->>'slug') then raise exception 'Clinic URL is already in use';end if;
 insert into public.owner_provision_operations(id,owner_id,clinic_slug,doctor_email) values(p_request,p_owner,p_data->>'slug',lower(trim(p_data->>'doctor_email'))) returning * into op;
 return to_jsonb(op);
end$$;
create function public.owner_complete_tenant(p_owner uuid,p_request uuid,p_lease uuid,p_data jsonb,p_services jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.owner_provision_operations;tenant jsonb;
begin
 if not private.is_platform_admin_user(p_owner) then raise exception 'Platform administrator required' using errcode='42501';end if;
 select * into op from public.owner_provision_operations where id=p_request and owner_id=p_owner for update;
 if op.id is null or op.lease_token<>p_lease or op.state<>'prepared' then raise exception 'Invalid operation state';end if;
 if op.clinic_slug<>p_data->>'slug' or op.doctor_email<>lower(trim(p_data->>'doctor_email')) then raise exception 'Request details changed';end if;
 perform private.validate_owner_create(p_data,p_services);
 tenant=public.platform_admin_create_tenant_pending(p_owner,op.doctor_user_id,p_data,p_services);
 update public.owner_provision_operations set state='completed',clinic_id=(tenant->>'id')::uuid,updated_at=now() where id=op.id;
 return tenant;
end$$;
create function public.owner_cancel_tenant(p_owner uuid,p_request uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.owner_provision_operations;
begin
 if not private.is_platform_admin_user(p_owner) then raise exception 'Platform administrator required' using errcode='42501';end if;
 select * into op from public.owner_provision_operations where id=p_request and owner_id=p_owner for update;
 if op.id is null or op.lease_token<>p_lease then raise exception 'Invalid operation state';end if;
 if op.state<>'completed' then
  if exists(select 1 from public.memberships where user_id=op.doctor_user_id) then raise exception 'Linked account cannot be cleaned';end if;
  update public.owner_provision_operations set state='cleanup_required',updated_at=now() where id=op.id returning * into op;
 end if;
 return to_jsonb(op);
end$$;

create function public.owner_delete_clinic(p_owner uuid,p_clinic uuid,p_confirmation text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.clinics;r public.owner_deletion_receipts;paths jsonb;
begin
 if not private.is_platform_admin_user(p_owner) then raise exception 'Platform administrator required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 select * into r from public.owner_deletion_receipts where id=p_request;
 if r.id is not null then
  if r.owner_id<>p_owner or r.clinic_id<>p_clinic or trim(p_confirmation) not in (r.confirmation_name,r.confirmation_slug) then raise exception 'Invalid deletion request';end if;
  return jsonb_build_object('deleted',true,'receipt_id',r.id,'media_pending',not r.media_deleted);
 end if;
 select * into c from public.clinics where id=p_clinic for update;
 if c.id is null then raise exception 'Clinic unavailable';end if;
 if p_confirmation is null or trim(p_confirmation) not in (c.name,c.slug) then raise exception 'Clinic confirmation mismatch';end if;
 select coalesce(jsonb_agg(name),'[]') into paths from storage.objects where bucket_id='clinic-media' and split_part(name,'/',1)=p_clinic::text;
 insert into public.owner_deletion_receipts(id,owner_id,clinic_id,confirmation_name,confirmation_slug,storage_paths,media_deleted)
 values(p_request,p_owner,p_clinic,c.name,c.slug,paths,jsonb_array_length(paths)=0) returning * into r;
 delete from public.push_subscriptions where clinic_id=p_clinic;
 delete from public.booking_capabilities where clinic_id=p_clinic;
 delete from public.notification_deliveries d using public.notifications n where d.notification_id=n.id and n.clinic_id=p_clinic;
 delete from public.notifications where clinic_id=p_clinic;
 delete from public.encounters where clinic_id=p_clinic;
 delete from public.medical_records where clinic_id=p_clinic;
 delete from public.payments where clinic_id=p_clinic;
 delete from public.appointments where clinic_id=p_clinic;
 delete from public.patients where clinic_id=p_clinic;
 delete from public.services where clinic_id=p_clinic;
 delete from public.clinic_change_requests where clinic_id=p_clinic;
 delete from public.clinic_subscriptions where clinic_id=p_clinic;
 delete from public.clinic_domains where clinic_id=p_clinic;
 delete from public.doctor_activation_requests where clinic_id=p_clinic;
 delete from public.memberships where clinic_id=p_clinic;
 delete from public.audit_log where clinic_id=p_clinic;
 delete from public.clinics where id=p_clinic;
 return jsonb_build_object('deleted',true,'receipt_id',r.id,'media_pending',not r.media_deleted);
end$$;
revoke all on function public.owner_prepare_tenant(uuid,uuid,jsonb,jsonb),public.owner_complete_tenant(uuid,uuid,uuid,jsonb,jsonb),public.owner_cancel_tenant(uuid,uuid,uuid),public.owner_delete_clinic(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.owner_prepare_tenant(uuid,uuid,jsonb,jsonb),public.owner_complete_tenant(uuid,uuid,uuid,jsonb,jsonb),public.owner_cancel_tenant(uuid,uuid,uuid),public.owner_delete_clinic(uuid,uuid,text,uuid) to service_role;
-- Repair/create RPCs still require a verified platform owner inside the transaction.
revoke all on function public.platform_admin_create_tenant(uuid,uuid,jsonb,jsonb),public.platform_admin_update_clinic(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.platform_admin_create_tenant(uuid,uuid,jsonb,jsonb),public.platform_admin_update_clinic(uuid,uuid,jsonb,jsonb) to service_role;
create function public.owner_acquire_cleanup(p_owner uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.owner_provision_operations;
begin
 if not private.is_platform_admin_user(p_owner) then raise exception 'Platform administrator required' using errcode='42501';end if;
 select * into op from public.owner_provision_operations where id=p_request and owner_id=p_owner for update;
 if op.id is null then raise exception 'Operation unavailable';end if;
 if op.state='completed' then return to_jsonb(op);end if;
 if op.lease_until>now() then raise exception 'Operation in progress';end if;
 update public.owner_provision_operations set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where id=op.id returning * into op;
 return to_jsonb(op);
end$$;
revoke all on function public.owner_acquire_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_acquire_cleanup(uuid,uuid) to service_role;
commit;
