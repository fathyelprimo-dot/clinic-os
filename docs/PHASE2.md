# Phase 2 implementation and activation

This extends the existing Clinic OS visual foundation. The navy/teal layout, Arabic RTL booking surface, stats, queue and tables remain. It is connected to a new Supabase project; the schema is active, but real clinic and account data have not been provisioned.

The 2026-10-01 interface update adds locally bundled Arabic typography, clearer booking/service/payment information, a staff sidebar, date and status filters, patient-directory search, inline form errors, booking-reference copy, and responsive page layouts. The single-file preview embeds the font and deliberately excludes live configuration. Normal startup now fails closed when Supabase is unconfigured; fake records and simulated writes are available only through an explicit `?demo=1` preview.

Supabase project `Clinic OS` now exists in organization `clinic-os` in `eu-west-1` at the reported cost of USD 0/month. The six migrations are applied, all clinic data tables have RLS enabled, the public publishable key is configured, and the role/RLS SQL integration test passed. The database is intentionally empty: no clinic tenant, doctor Auth user/membership, or real service settings have been provisioned.

## Implemented

| Capability | Code path / behavior |
|---|---|
| Doctor-controlled services | Name, category, price, duration, priority and active status; four initial demo categories; only doctor RPC can change them |
| Payments | Cash, InstaPay, wallet; doctor-configured destinations, manual staff receipt confirmation and immutable receipt record; no automatic transfer verification |
| Smart ETA | Current elapsed visit, configured duration, average of up to 20 completed visits after 3 samples, bounded learned duration, priority and appointment eligibility, pause, travel and arrival buffer |
| Patient records | Tenant-scoped contact directory; staff can explicitly reuse a patient; only doctor can read clinical history, allergies, diagnosis, medications and printable prescriptions |
| Auth and roles | Supabase staff email/password; patient phone verification using SMS OTP; membership role read from server, never self-assigned; sessions in memory with token refresh |
| Multi-tenancy | Composite foreign keys and tenant-scoped RLS; verified custom-domain mapping or shared-domain `?clinic=slug`; doctor name/photo/address/accent |
| Realtime | Authenticated Postgres Changes subscription with reconnect and heartbeat; RLS restricts events; 30-second refresh fallback |
| Notifications | In-app/browser reminders while open; durable DB reminders; service-role-only delivery leases, retries and provider idempotency key through an optional webhook adapter |
| Concurrency | Per-clinic transaction lock for bookings and queue mutations, overlap rejection, booking request idempotency, expected-current guard on next-patient action |

ETA is statistical scheduling logic, **not an AI/LLM diagnosis or a trained predictive model**. Travel time is patient-entered, not live traffic. Emergencies require doctor review; they never preempt an ongoing visit automatically.

## Persistence and execution modes

| Data | PostgreSQL source of truth | Browser behavior |
|---|---|---|
| Bookings and queue | `appointments`; transactional `book_appointment` and `staff_action` RPCs; older history via paginated `clinic_booking_history` | Recent queue plus authenticated historical pages are fetched from PostgreSQL |
| Patient contacts | `patients`; created or linked by the booking RPC | Tenant-scoped, paginated reads; never saved in browser storage |
| Payments | `payments`; written by the staff payment action alongside appointment paid state | Read through tenant/RLS-filtered booking data for the dashboard |
| Visits and prescriptions | `medical_records` and `encounters`; doctor-only `save_encounter` RPC | Doctor-only reads; draft fields stay in the open form until saved |
| Services and clinic settings | `services` and `clinics`; doctor-only `save_service` and `save_clinic` RPCs | Loaded from the resolved tenant and refreshed from Supabase |
| Queue notifications | `notifications`; generated in PostgreSQL and delivered through the server dispatcher | Realtime/in-app display; no device-local notification history |
| Auth | Supabase Auth users, phone OTP, clinic memberships | Access and refresh tokens stay in JavaScript memory; logging in again after reload is intentional |

There are no calls to `localStorage`, `sessionStorage`, or IndexedDB in the active browser app. Arrays in `stage2.js` are volatile render caches/forms or explicit demo fixtures. They are never a fallback store for the normal app.

- `dist/index.html?demo=1` runs the isolated, in-memory preview with doctor/reception role switching. Never enter real records there.
- `dist/index.html` uses the configured Supabase project. Until a published clinic and tenant slug exist, it displays a setup message and blocks bookings; it never falls back to mock records.
- The project URL and publishable key are already configured. Connection errors disable data entry instead of silently reverting to demo.
- `npm run ui:sync` copies this SAME interface to `public/clinic/`. The React route embeds it, preserving URL query parameters. `predev` and `prebuild` synchronize automatically. The duplicated phase-one business logic was removed.
- Staff sessions and OTP sessions do not survive reload; this intentionally avoids storing patient data or auth tokens in localStorage.

## Activate Supabase

1. The current project is already created; for another environment, create or select the owner's Supabase project. Do not paste service-role keys into chat or browser files.
2. The six migrations are already applied to this project. For a fresh project, apply them in numeric order using the Supabase CLI (`supabase db push`) or SQL Editor. Never rerun them on an already migrated database.
3. `supabase/tests/tenant_roles.sql` passed on this project and rolls back its temporary test users and records. Run it again on disposable databases after schema changes.
4. Create the real clinic row, service settings, and staff Auth users through administrator-controlled provisioning. Assign membership rows with `role='doctor'` or `'reception'`. There is no public role-grant endpoint. Example provisioning is in `supabase/provision.example.sql`.
5. Create the clinic doctor in Supabase Auth, add the owner-controlled `memberships` row with `role='doctor'`, then add real clinic settings and services. Do not publish sample clinic details or prices as live data. Configure an SMS provider and abuse protection for patient phone OTP; staff use the pre-provisioned email/password account. No phone provider is configured by this code.
6. The project HTTPS URL and **publishable key** are already in `dist/config.js`. Set `clinicSlug` after the real clinic row is provisioned. Never use secret/service-role keys. Run `npm run ui:sync` after changing config.
7. For custom doctor domains, verify ownership using the hosting provider, then insert the exact hostname in `clinic_domains` with `verified=true`. Domain lookup chooses branding; authorization still comes from tenant RLS/membership, not the host or a browser-supplied tenant ID.
8. Validate two clinics with doctor/reception/patient accounts, simultaneous booking/queue actions, and Realtime before enabling real appointments. The migrations and SQL tenant-role/RLS tests have run on the new Supabase project; browser and React build validation are still blocked by unavailable workspace dependencies.

## Notifications

Enable Supabase Cron and schedule `select public.generate_reminders();` every minute. It creates consented in-app reminders even when no browser is open. The client displays them after reconnect/login.

For external delivery, deploy `supabase/functions/notification-dispatch` with JWT verification disabled **only because it validates its own `DISPATCH_SECRET` bearer**. Store these server-side environment secrets:

- `DISPATCH_SECRET`: a random high-entropy cron credential.
- `NOTIFICATION_WEBHOOK_URL`: your contracted HTTPS SMS/WhatsApp adapter endpoint.
- `NOTIFICATION_WEBHOOK_TOKEN`: provider authentication.
- Supabase server function environment supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Schedule a server-side POST once per minute with `Authorization: Bearer <DISPATCH_SECRET>`. The adapter receives `{to,message,reference}` and an `Idempotency-Key`. It MUST deduplicate that key and return a non-2xx on failure. A 2xx means provider acceptance, not delivery to handset. Configure provider receipts separately if you need delivery status. No provider, cron job or real message was activated during this implementation.

Only unexpired reminders (10 minutes), consented active visits, an unpaused queue, and appropriate visit states can be claimed. Leases prevent concurrent workers claiming the same message; completion requires the lease token. No diagnoses or medications are sent.

## Verification and limitations

- `npm run test:phase2` runs 32 domain, mocked transport, static persistence, RLS, Realtime subscription, and no-browser-storage contract checks without packages.
- Coverage includes past-slot exclusion, clinic-closing boundaries, overlapping reservations, cancellation availability, keyset-paginated history, and the Supabase persistence boundary.
- `node scripts/browser-smoke.mjs <output-directory>` can run the UI smoke checks in explicit demo mode with optional Playwright installed (or `CODEX_PRIMARY_RUNTIME_NODE_MODULES` pointing to the supplied runtime modules). It did not run here because the configured Microsoft Edge binary is missing.
- `node --check dist/stage2.js` validates browser JavaScript syntax.
- `supabase/tests/tenant_roles.sql` passed against the new Supabase database; fixture users, clinic rows, and patients were rolled back and verified absent afterward.
- Browser visual QA is blocked because the configured Microsoft Edge binary is missing. The framework build and lint commands are blocked because `vinext` and `eslint` are not installed in this workspace.
- Medical records are doctor-only. The initial prescription is printable for handoff; patient self-service access to clinical history is not exposed.
- Paid-booking cancellation/refunds require a later audited refund workflow; current cancellation deliberately rejects paid appointments.
- The patient directory reads all tenant patients in bounded pages. The fast dashboard snapshot includes recent and future bookings; selecting an older date or “all dates” loads older appointments in keyset-paginated batches. Scheduling supports one continuous daily opening window per clinic.
- New public deployment and GitHub push are not claimed; remote activation requires access/configuration.

Migration `202610010001_persistence_realtime.sql` adds tenant-filtered patient, payment and doctor-only clinical tables to Supabase Realtime while retaining RLS. Migration `202610010002_foreign_key_indexes.sql` adds covering indexes for the foreign-key access paths flagged by Supabase performance advisors. Migration `202610010003_appointment_history.sql` adds role-scoped, keyset-paginated access to older bookings without storing an archive on the device. The remaining security advisor warnings concern intentionally public reads of published clinic branding/availability and role-checked security-definer mutation RPCs; the database role test validated that reception cannot read clinical records or change doctor-only settings.

Primary references used: Supabase RLS (`https://supabase.com/docs/guides/database/postgres/row-level-security`), Postgres Changes (`https://supabase.com/docs/guides/realtime/postgres-changes`), password auth (`https://supabase.com/docs/guides/auth/passwords`), and Google Maps URLs (`https://developers.google.com/maps/documentation/urls/get-started`).
