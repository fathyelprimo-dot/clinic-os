# Clinic OS — phase 2

Existing Arabic RTL visual foundation, extended with doctor-controlled services, priority queue and ETA, clinic branding/maps, payment tracking, patient medical records and printable prescriptions, plus a Supabase Auth/RLS/Realtime implementation.

**Supabase is connected to a new, empty Clinic OS project.** The six migrations and RLS policies are applied, and the public publishable key is configured. No clinic tenant, clinic profile, services, or doctor Auth membership has been provisioned yet, so the live interface shows a setup message and does not accept bookings until those records exist. The isolated, in-memory preview requires `?demo=1`.

## Preview and tests

The existing navy/teal identity now has a redesigned patient journey, service cards, tracking explanation, FAQ, and staff navigation with appointment date/status filters and patient search. A locally bundled variable Noto Sans Arabic font keeps typography available without a font CDN. Its OFL license is included in `dist/fonts/OFL.txt`.

Open `dist/index.html?demo=1` in a browser to use “تجربة لوحة العيادة” and switch between doctor/reception preview roles. No installation is needed. Demo records last only in page memory; never enter real patient data in demo mode. Opening `dist/index.html` without the query loads no mock appointments or clinic records.

```sh
node scripts/test-phase2.mjs
node scripts/sync-ui.mjs
```

On a machine with npm registry access:

```sh
npm ci
npm run dev
```

The framework route embeds the same synchronized UI; there is one active implementation of business behavior. No separate outdated React booking flow remains.

## Key files

- `dist/stage2.js`: booking, staff controls, medical records and live/demo adapters.
- `dist/experience.css`: responsive visual improvements, locally hosted Arabic typography and accessible dialog styles.
- `dist/domain.js`: service validation, Cairo dates, smart ETA and Maps links.
- `dist/supabase-client.js`: Supabase Auth/REST RPC and Realtime transport.
- `dist/config.js`: **public** project URL/key and optional default clinic slug only.
- `supabase/migrations/`: schema, RLS, authenticated RPC, transactional queue and notification delivery.
- `supabase/tests/tenant_roles.sql`: database tenant/role tests, ready to run on a disposable Supabase project.
- `supabase/functions/notification-dispatch/`: optional external provider adapter, server secrets only.
- `docs/PHASE2.md`: setup, provisioning, notification contract and actual validation limits.

All durable clinic data is in Supabase PostgreSQL. Recent appointments and the queue load at sign-in; older appointments and payments load through authenticated, bounded pages. Browser arrays are short-lived UI caches of database responses, form drafts, or isolated demo fixtures; the application never writes business records or auth tokens to `localStorage`, `sessionStorage`, or IndexedDB. Patients are fetched in pages, bookings and queue actions go through transactional RPCs, and each tenant table is protected by RLS.

Cash, InstaPay and wallet receipts require manual staff confirmation. Selecting a payment method never marks a booking paid. ETA is an adaptive statistical estimate; it is not a medical AI or a traffic prediction service.

Supabase project dashboard: https://supabase.com/dashboard/project/xgowtcloqiivxeqhgndr. The project is empty by design until the clinic profile, real doctor Auth user/membership, and doctor-selected services are provisioned.

32 domain, transport and persistence-contract checks pass, and the tenant-role SQL integration test passed on the new Supabase project. The browser smoke test could not run because Playwright’s configured Microsoft Edge binary is not installed; the framework build and lint tools are also missing from the workspace dependencies.
