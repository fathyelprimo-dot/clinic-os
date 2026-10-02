begin;
create table public.notification_deliveries(
 notification_id uuid primary key references public.notifications(id),state text not null default 'pending' check(state in ('pending','sending','sent','failed')),attempts int not null default 0,next_attempt_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,sent_at timestamptz,last_error text
);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon,authenticated;
create function private.enqueue_notification() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.notification_deliveries(notification_id) values(new.id);return new;end$$;
revoke all on function private.enqueue_notification() from public;
create trigger queue_delivery after insert on public.notifications for each row execute function private.enqueue_notification();
create function public.claim_notifications() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 with eligible as(select d.notification_id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.appointments a on a.id=n.appointment_id join public.clinics c on c.id=n.clinic_id
 where d.state in ('pending','sending') and d.attempts<5 and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now()) and n.created_at>now()-interval '10 minutes' and not c.paused and a.notification_consent and ((n.kind='leave' and a.status='waiting' and not a.arrived) or(n.kind='turn' and a.status='inside')) order by n.created_at limit 20 for update of d skip locked),claimed as(update public.notification_deliveries d set state='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid() from eligible e where d.notification_id=e.notification_id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',d.notification_id,'lease',d.lease_token,'phone',p.phone,'message',n.message)),'[]'::jsonb) into result from claimed d join public.notifications n on n.id=d.notification_id join public.patients p on (p.clinic_id,p.id)=(n.clinic_id,n.patient_id);
 return result;
end$$;
create function public.finish_notification(p_id uuid,p_lease uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$begin
 update public.notification_deliveries set state=case when p_success then 'sent' when attempts>=5 then 'failed' else 'pending' end,sent_at=case when p_success then now() else null end,lease_until=null,next_attempt_at=now()+least(300,power(2,attempts)::int*15)*interval '1 second',last_error=case when p_success then null else 'Provider request failed' end where notification_id=p_id and lease_token=p_lease and state='sending';
end$$;
revoke all on function public.claim_notifications(),public.finish_notification(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_notifications(),public.finish_notification(uuid,uuid,boolean) to service_role;
commit;
