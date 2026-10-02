begin;

-- Keep the complete patient and clinical-financial record stream in the same
-- RLS-protected publication as bookings, settings, services and reminders.
alter table public.patients enable row level security;
alter table public.payments enable row level security;
alter table public.medical_records enable row level security;
alter table public.encounters enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['patients','payments','medical_records','encounters'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

commit;
