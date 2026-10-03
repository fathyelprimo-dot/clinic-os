-- Narrow repair for the current deployed owner schema. Keeps existing clinic RPCs and data.
begin;
create table if not exists public.owner_provision_operations(
 id uuid primary key,owner_id uuid not null references auth.users,doctor_user_id uuid not null unique default gen_random_uuid(),
 clinic_slug text not null,doctor_email text not null,clinic_id uuid references public.clinics on delete set null,
 state text not null default 'prepared' check(state in ('prepared','completed','cleanup_required','failed')),
 lease_until timestamptz not null default now()+interval '2 minutes',lease_token uuid not null default gen_random_uuid(),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists owner_provision_slug_reservation on public.owner_provision_operations(clinic_slug) where state in ('prepared','cleanup_required');
create table if not exists public.owner_deletion_receipts(
 id uuid primary key,owner_id uuid not null references auth.users,clinic_id uuid not null,
 confirmation_name text not null,confirmation_slug text not null,storage_paths jsonb not null default '[]',
 media_deleted boolean not null default false,created_at timestamptz not null default now()
);
alter table public.owner_provision_operations enable row level security;
alter table public.owner_deletion_receipts enable row level security;
revoke all on public.owner_provision_operations,public.owner_deletion_receipts from public,anon,authenticated;
grant all on public.owner_provision_operations,public.owner_deletion_receipts to service_role;

create or replace function private.validate_owner_create(p_data jsonb,p_services jsonb) returns void language plpgsql set search_path='' as $$
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

create or replace function public.owner_prepare_tenant(p_owner uuid,p_request uuid,p_data jsonb,p_services jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
create or replace function public.owner_complete_tenant(p_owner uuid,p_request uuid,p_lease uuid,p_data jsonb,p_services jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
create or replace function public.owner_cancel_tenant(p_owner uuid,p_request uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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

create or replace function public.owner_acquire_cleanup(p_owner uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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

revoke all on function public.owner_prepare_tenant(uuid,uuid,jsonb,jsonb),public.owner_complete_tenant(uuid,uuid,uuid,jsonb,jsonb),public.owner_cancel_tenant(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.owner_prepare_tenant(uuid,uuid,jsonb,jsonb),public.owner_complete_tenant(uuid,uuid,uuid,jsonb,jsonb),public.owner_cancel_tenant(uuid,uuid,uuid) to service_role;
commit;
