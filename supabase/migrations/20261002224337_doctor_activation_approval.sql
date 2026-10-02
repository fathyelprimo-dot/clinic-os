-- New doctor invitations remain inactive until the platform owner approves them.
create table public.doctor_activation_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_user_id uuid not null references auth.users(id) on delete cascade,
  doctor_email text not null check (length(doctor_email) between 3 and 254),
  doctor_name text not null check (length(trim(doctor_name)) between 2 and 100),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  unique (clinic_id, doctor_user_id)
);

create index doctor_activation_requests_status_requested_idx
  on public.doctor_activation_requests(status, requested_at desc);
create index doctor_activation_requests_doctor_user_idx
  on public.doctor_activation_requests(doctor_user_id, clinic_id);

alter table public.doctor_activation_requests enable row level security;
revoke all on public.doctor_activation_requests from public, anon, authenticated;
grant all on public.doctor_activation_requests to service_role;

create or replace function public.platform_admin_create_tenant_pending(
  p_admin_user_id uuid,
  p_doctor_user_id uuid,
  p_data jsonb,
  p_services jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;

create or replace function public.platform_admin_list_doctor_activation_requests(
  p_admin_user_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.is_platform_admin_user(p_admin_user_id) then
    raise exception 'Platform administrator required' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(items) order by items.requested_at desc),'[]'::jsonb)
    into result
  from (
    select r.id,r.clinic_id,c.name as clinic_name,c.slug as clinic_slug,
      r.doctor_user_id,r.doctor_email,r.doctor_name,r.status,
      r.requested_at,r.reviewed_at
    from public.doctor_activation_requests r
    join public.clinics c on c.id=r.clinic_id
    order by r.requested_at desc
    limit 100
  ) items;
  return result;
end;
$$;

create or replace function public.platform_admin_decide_doctor_activation_request(
  p_admin_user_id uuid,
  p_request_id uuid,
  p_decision text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  request_row public.doctor_activation_requests;
  next_status text;
begin
  if not private.is_platform_admin_user(p_admin_user_id) then
    raise exception 'Platform administrator required' using errcode='42501';
  end if;
  if p_decision not in ('approve','reject') then
    raise exception 'Decision must be approve or reject';
  end if;

  select * into request_row
  from public.doctor_activation_requests
  where id=p_request_id
  for update;
  if request_row.id is null then raise exception 'Activation request unavailable'; end if;
  if request_row.status <> 'pending' then raise exception 'Activation request already reviewed'; end if;

  next_status := case when p_decision='approve' then 'approved' else 'rejected' end;
  update public.clinics
    set is_active=(p_decision='approve')
    where id=request_row.clinic_id;
  update public.doctor_activation_requests
    set status=next_status,reviewed_by=p_admin_user_id,reviewed_at=now()
    where id=request_row.id;
  insert into public.audit_log(clinic_id,actor,action,record_id)
    values(request_row.clinic_id,p_admin_user_id,
      case when p_decision='approve' then 'doctor_activation_approved' else 'doctor_activation_rejected' end,
      request_row.clinic_id);

  return jsonb_build_object(
    'request_id',request_row.id,'clinic_id',request_row.clinic_id,
    'status',next_status,'is_active',(p_decision='approve')
  );
end;
$$;

create or replace function public.doctor_activation_status(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select jsonb_build_object(
    'status',r.status,'clinic_name',c.name,'clinic_slug',c.slug
  ) into result
  from public.doctor_activation_requests r
  join public.clinics c on c.id=r.clinic_id
  where c.slug=p_slug and r.doctor_user_id=(select auth.uid())
  order by r.requested_at desc limit 1;
  return coalesce(result,jsonb_build_object('status','none'));
end;
$$;

revoke all on function public.platform_admin_create_tenant_pending(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.platform_admin_list_doctor_activation_requests(uuid) from public, anon, authenticated;
revoke all on function public.platform_admin_decide_doctor_activation_request(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.doctor_activation_status(text) from public, anon, authenticated;
grant execute on function public.platform_admin_create_tenant_pending(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.platform_admin_list_doctor_activation_requests(uuid) to service_role;
grant execute on function public.platform_admin_decide_doctor_activation_request(uuid,uuid,text) to service_role;
grant execute on function public.doctor_activation_status(text) to authenticated;
