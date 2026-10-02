-- Run AFTER migrations on a disposable Supabase database with psql -v ON_ERROR_STOP=1.
-- Transaction is rolled back; do not substitute production accounts.
begin;
insert into auth.users(id,email) values('10000000-0000-0000-0000-000000000001','doctor-a@example.test'),('10000000-0000-0000-0000-000000000002','reception-a@example.test'),('10000000-0000-0000-0000-000000000003','doctor-b@example.test'),('10000000-0000-0000-0000-000000000004','patient-a@example.test');
insert into public.clinics(id,slug,name,published) values('20000000-0000-0000-0000-000000000001','test-clinic-a','A',true),('20000000-0000-0000-0000-000000000002','test-clinic-b','B',true);
insert into public.memberships values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','doctor'),('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','reception'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','doctor');
insert into public.patients(id,clinic_id,user_id,name,phone) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','Test A','01000000001'),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',null,'Test B','01000000002');
insert into public.services(id,clinic_id,name,category,price,duration_minutes,priority) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Regular','normal',350,20,0);
insert into public.appointments(id,clinic_id,patient_id,service_id,requested_by,request_key,scheduled_at,service_name,price,duration_minutes,priority,category,status,payment_method) values('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',now()-interval '60 days','Regular',350,20,0,'normal','done','cash');
insert into public.medical_records(clinic_id,patient_id,history) values('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','PRIVATE');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$begin
 if (select count(*) from public.patients)<>1 then raise exception 'FAIL cross-tenant patient exposure';end if;
 if exists(select 1 from public.medical_records) then raise exception 'FAIL reception can read clinical data';end if;
 if jsonb_array_length(public.clinic_booking_history('20000000-0000-0000-0000-000000000001'))<>1 then raise exception 'FAIL reception cannot read historical booking';end if;
 if jsonb_array_length(public.clinic_booking_history('20000000-0000-0000-0000-000000000002'))<>0 then raise exception 'FAIL cross-tenant historical booking exposure';end if;
 begin
  perform public.save_service('20000000-0000-0000-0000-000000000001',null,'{"name":"Test","category":"normal","price":100,"duration_minutes":20,"priority":0,"active":true}');
  raise exception 'FAIL reception wrote service';
 exception when raise_exception then if sqlerrm<>'Doctor only' then raise;end if;end;
 begin
  insert into public.memberships values('20000000-0000-0000-0000-000000000001',auth.uid(),'doctor');
  raise exception 'FAIL privilege escalation';
 exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$begin
 if (select count(*) from public.medical_records)<>1 then raise exception 'FAIL doctor cannot read own records';end if;
 if jsonb_array_length(public.clinic_booking_history('20000000-0000-0000-0000-000000000001'))<>1 then raise exception 'FAIL doctor cannot read historical booking';end if;
 begin perform public.staff_action('20000000-0000-0000-0000-000000000002','pause');raise exception 'FAIL cross-tenant queue mutation';exception when raise_exception then if sqlerrm<>'Staff only' then raise;end if;end;
end$$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
do $$begin
 if jsonb_array_length(public.clinic_booking_history('20000000-0000-0000-0000-000000000001'))<>1 then raise exception 'FAIL patient cannot read own historical booking';end if;
 if jsonb_array_length(public.clinic_booking_history('20000000-0000-0000-0000-000000000002'))<>0 then raise exception 'FAIL patient can read another tenant history';end if;
end$$;
reset role;
set local role anon;
do $$begin
 if (select count(*) from public.clinics where slug like 'test-clinic-%')<>2 then raise exception 'FAIL public branding';end if;
 begin perform * from public.patients;raise exception 'FAIL anonymous patient read';exception when insufficient_privilege then null;end;
end$$;
reset role;

-- Owner suspension must immediately gate an existing staff session and all tenant reads.
update public.clinics set is_active=false where id='20000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$begin
 if exists(select 1 from public.patients where clinic_id='20000000-0000-0000-0000-000000000001') then raise exception 'FAIL suspended clinic exposes patients';end if;
 if exists(select 1 from public.appointments where clinic_id='20000000-0000-0000-0000-000000000001') then raise exception 'FAIL suspended clinic exposes appointments';end if;
 begin perform public.clinic_snapshot('20000000-0000-0000-0000-000000000001');raise exception 'FAIL suspended clinic snapshot';exception when raise_exception then if sqlerrm<>'Clinic unavailable' then raise;end if;end;
 begin perform public.staff_action('20000000-0000-0000-0000-000000000001','pause');raise exception 'FAIL suspended clinic queue mutation';exception when raise_exception then if sqlerrm<>'Staff only' then raise;end if;end;
end$$;
reset role;

-- The Cairo-local expiry date is inclusive; access remains available on that date.
update public.clinics set is_active=true where id='20000000-0000-0000-0000-000000000001';
insert into public.clinic_subscriptions(clinic_id,ends_on)
values('20000000-0000-0000-0000-000000000001',(now() at time zone 'Africa/Cairo')::date);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$begin
 if (select count(*) from public.patients where clinic_id='20000000-0000-0000-0000-000000000001')<>1 then raise exception 'FAIL subscription expires before its Cairo end date';end if;
 if public.save_service('20000000-0000-0000-0000-000000000001',null,'{"name":"Boundary test","category":"normal","price":100,"duration_minutes":20,"priority":0,"active":true}') is null then raise exception 'FAIL active subscription cannot save service';end if;
end$$;
reset role;

-- The day after expiry, RLS, snapshots, queue actions and public resolution all deny access.
update public.clinic_subscriptions
set ends_on=(now() at time zone 'Africa/Cairo')::date-1
where clinic_id='20000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$begin
 if exists(select 1 from public.patients where clinic_id='20000000-0000-0000-0000-000000000001') then raise exception 'FAIL expired clinic exposes patients';end if;
 if exists(select 1 from public.appointments where clinic_id='20000000-0000-0000-0000-000000000001') then raise exception 'FAIL expired clinic exposes appointments';end if;
 begin perform public.clinic_snapshot('20000000-0000-0000-0000-000000000001');raise exception 'FAIL expired clinic snapshot';exception when raise_exception then if sqlerrm<>'Clinic unavailable' then raise;end if;end;
 begin perform public.staff_action('20000000-0000-0000-0000-000000000001','pause');raise exception 'FAIL expired clinic queue mutation';exception when raise_exception then if sqlerrm<>'Clinic unavailable' then raise;end if;end;
 begin perform public.save_service('20000000-0000-0000-0000-000000000001',null,'{"name":"Expired test","category":"normal","price":100,"duration_minutes":20,"priority":0,"active":true}');raise exception 'FAIL expired clinic accepted a service';exception when raise_exception then if sqlerrm<>'Clinic unavailable' then raise;end if;end;
end$$;
reset role;
set local role anon;
do $$begin
 if (select count(*) from public.clinics where slug like 'test-clinic-%')<>1 then raise exception 'FAIL expired clinic remains publicly listed';end if;
 begin perform public.resolve_clinic('example.test','test-clinic-a');raise exception 'FAIL expired public clinic resolution';exception when raise_exception then if sqlerrm<>'Clinic unavailable' then raise;end if;end;
end$$;
reset role;
rollback;
