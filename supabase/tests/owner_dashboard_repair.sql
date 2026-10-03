-- Real PostgreSQL smoke test: synthetic UUIDs only, no Auth passwords or network calls.
-- Everything is rolled back; never substitute existing accounts or clinic IDs.
begin;
do $$
declare
 owner_id uuid=gen_random_uuid(); outsider_id uuid=gen_random_uuid(); request_id uuid=gen_random_uuid();
 op jsonb; tenant jsonb; details jsonb; catalog jsonb; doctor_id uuid; test_clinic_id uuid;
 service_id uuid; patient_id uuid; booking_id uuid; other_id uuid=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (owner_id,'verification-owner-'||owner_id||'@example.test',now()),
 (outsider_id,'verification-outsider-'||outsider_id||'@example.test',now());
 insert into public.platform_admins(user_id) values(owner_id);
 details=jsonb_build_object('name','عيادة اختبار معزولة','slug','verify-'||request_id,
  'doctor_name','طبيب الاختبار','doctor_email','verification-doctor-'||request_id||'@example.test');
 catalog='[{"name":"كشف اختبار","category":"normal","price":125.5,"duration_minutes":20,"priority":0,"active":true}]';
 op=public.owner_prepare_tenant(owner_id,request_id,details,catalog);
 doctor_id=(op->>'doctor_user_id')::uuid;
 insert into auth.users(id,email,email_confirmed_at) values(doctor_id,details->>'doctor_email',now());
 tenant=public.owner_complete_tenant(owner_id,request_id,(op->>'lease_token')::uuid,details,catalog);
 test_clinic_id=(tenant->>'id')::uuid;
 if (select is_active from public.clinics where id=test_clinic_id) then raise exception 'New clinic must await activation';end if;
 if (select count(*) from public.services where public.services.clinic_id=test_clinic_id)<>1 then raise exception 'Catalog not saved';end if;
 if not exists(select 1 from public.doctor_activation_requests where public.doctor_activation_requests.clinic_id=test_clinic_id and status='pending') then raise exception 'Activation request missing';end if;
 if public.owner_prepare_tenant(owner_id,request_id,details,catalog)->>'state'<>'completed' then raise exception 'Retry lost completed outcome';end if;
 begin
  perform public.owner_prepare_tenant(outsider_id,gen_random_uuid(),details,catalog);
  raise exception 'Non-owner was allowed';
 exception when insufficient_privilege then null;end;
 if has_table_privilege('authenticated','public.owner_provision_operations','SELECT')
 or has_function_privilege('authenticated','public.owner_prepare_tenant(uuid,uuid,jsonb,jsonb)','EXECUTE') then raise exception 'Owner journal exposed to browser role';end if;
 -- Activate this test tenant only inside this uncommitted transaction.
 update public.clinics set is_active=true where id=test_clinic_id;
 insert into public.clinics(id,slug,name,published) values(other_id,'verify-'||other_id,'Other isolated clinic',true);
 select id into service_id from public.services where public.services.clinic_id=test_clinic_id;
 insert into public.patients(clinic_id,name,phone) values(test_clinic_id,'مريض اختبار','01000000001') returning id into patient_id;
 insert into public.appointments(clinic_id,patient_id,service_id,requested_by,request_key,scheduled_at,
  service_name,price,duration_minutes,priority,category,status,payment_method,arrived,triage)
 values(test_clinic_id,patient_id,service_id,doctor_id,gen_random_uuid(),now(),'Test',125.5,20,0,'normal','waiting','cash',true,'approved') returning id into booking_id;
 perform set_config('request.jwt.claim.sub',doctor_id::text,true);
 perform set_config('verification.clinic',test_clinic_id::text,true);
 perform set_config('verification.other',other_id::text,true);
 perform set_config('verification.booking',booking_id::text,true);
end$$;
set local role authenticated;
do $$
declare c uuid=current_setting('verification.clinic')::uuid;
 other_id uuid=current_setting('verification.other')::uuid;
 booking_id uuid=current_setting('verification.booking')::uuid;
begin
 if (select count(*) from public.patients where clinic_id=c)<>1 then raise exception 'Doctor cannot load patients';end if;
 if (select count(*) from public.services where clinic_id=c)<>1 then raise exception 'Doctor cannot load catalog';end if;
 if jsonb_array_length(public.clinic_snapshot(c)->'bookings')<>1 then raise exception 'Doctor cannot load bookings';end if;
 perform public.staff_action(c,'next');
 if (select status from public.appointments where id=booking_id)<>'inside' then raise exception 'Queue did not advance';end if;
 begin
  perform public.staff_action(other_id,'pause');raise exception 'Cross-clinic queue mutation allowed';
 exception when raise_exception then if sqlerrm<>'Staff only' then raise;end if;end;
end$$;
reset role;
rollback;
select 'PASS live journal creation, pending activation, retry, non-owner denial, services, patients, bookings, queue and isolation; all test data rolled back' as verification;
