begin;

create index if not exists appointments_clinic_patient_idx on public.appointments(clinic_id, patient_id);
create index if not exists appointments_clinic_service_idx on public.appointments(clinic_id, service_id);
create index if not exists appointments_requested_by_idx on public.appointments(requested_by);
create index if not exists clinic_domains_clinic_idx on public.clinic_domains(clinic_id);
create index if not exists encounters_clinic_appointment_patient_idx on public.encounters(clinic_id, appointment_id, patient_id);
create index if not exists encounters_doctor_idx on public.encounters(doctor_id);
create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists notifications_clinic_appointment_patient_idx on public.notifications(clinic_id, appointment_id, patient_id);
create index if not exists patients_user_idx on public.patients(user_id);
create index if not exists payments_clinic_appointment_idx on public.payments(clinic_id, appointment_id);
create index if not exists payments_received_by_idx on public.payments(received_by);

commit;
