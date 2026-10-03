-- Read-only snapshot of the affected RPC source, retrieved 2026-10-03.
-- Used only in isolated tests to reproduce the deployed validation failure.
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

  tenant := public.platform_admin_create_tenant(p_admin_user_id,p_doctor_user_id,p_data,p_services);
  clinic_id := (tenant->>'id')::uuid;

  update public.clinics set is_active=false where id=clinic_id;
  if not found then raise exception 'Created clinic unavailable'; end if;

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

