# Clinic OS

Clinic OS is an Arabic-first, RTL clinic booking and queue product built on the existing navy/teal visual foundation. It is designed as a multi-tenant, white-label SaaS: the platform owner provisions clinics, and each clinic receives patient and doctor routes under its own slug or verified domain.

## Current live-state check

- GitHub repository: https://github.com/fathyelprimo-dot/clinic-os
- Supabase project: `xgowtcloqiivxeqhgndr`
- The Supabase production project has 15 migrations applied, including server-side enforcement that immediately blocks tenant access when the owner suspends a clinic or its subscription has expired.
- The connected Site owner's email is on the Supabase owner-bootstrap allowlist, but it has not yet been claimed as a platform-admin Auth account. The database still has no clinic tenant, doctor membership, or live service catalog. The normal clinic route therefore fails closed and does not accept real bookings.
- The hosted preview at https://clinic-os-elprimo.violaelprimo.chatgpt.site is still on version 8. It is separate from this GitHub repository and does not automatically receive commits from `main`.
- Six base migrations are checked into this repository. Eight owner/onboarding/tenant migrations that are present in the production database are still missing from Git history. Production migration versions also differ from the old local filenames. Do not run `supabase db push` against production or use the repository to recreate a fresh database until that history is reconciled.

## Implemented product capabilities

- Doctor-managed visit services with normal, urgent, emergency, and follow-up categories, pricing, duration, priority, and availability.
- Direct phone-number patient booking without SMS, private booking tracking links, and separate existing verified-phone tracking.
- A queue dashboard, arrival/triage states, concurrency-safe queue actions, and adaptive ETA shown in days, hours, and minutes.
- Clinic profile customization, doctor photo, colors, three visual templates, Google Maps destinations, working hours, and Cash/InstaPay/mobile-wallet payment tracking.
- Patient directory, doctor-only medical history, diagnosis, medications, and printable prescriptions.
- Doctor/reception roles, Supabase Auth, tenant-scoped PostgreSQL RLS, Realtime updates, and no business-data persistence in browser storage.
- Owner dashboard for manual clinic slugs, clinic/service setup, initial doctor passwords, activation, subscription dates, supported branding fields, photo upload, and change requests.

Cash, InstaPay, and wallet payments are recorded for staff confirmation; no online card processor is connected. ETA is a statistical scheduling estimate, not medical AI or live traffic.

## What still needs activation or implementation

- The owner's email is allowlisted. Open `/owner.html`, choose «طلب تفعيل حساب المالك», and complete the secure email invitation/claim. Then create the first clinic and doctor membership and configure real services.
- Configure phone OTP only if retaining the existing verified-phone history flow; the new patient booking path does not use it.
- Configure VAPID, the notification dispatcher schedule, SMTP and Auth redirect URLs as described in [the local setup guide](docs/PATIENT-PUSH-AUTH-SETUP.md). Web Push now uses the existing delivery queue and a Service Worker; real delivery still requires external configuration and device testing.
- Buy and verify the intended domain, then configure DNS and the verified clinic-domain records.
- The owner can edit the supported clinic/profile/service fields. A general page builder that lets the owner rewrite every page label and freely reorder every section is not implemented.
- Online payment processing, telehealth, automated cancellation waitlists, insurance search, verified public reviews, and marketplace discovery are not connected.

## Preview and local development

The explicit demo uses fake in-memory records. Never enter real patient information in demo mode.

```sh
npm ci
npm run dev
```

Open the local address printed by the dev command. Add `?demo=1` for the isolated demo. Without that query, the app requires its Supabase tenant and never falls back to fake clinic data.

## Verification

- `node scripts/test-phase2.mjs` runs 45 domain, transport, UI-contract, persistence, and owner-dashboard checks.
- `supabase/tests/tenant_roles.sql` includes the tenant-isolation suite plus new checks for manual suspension, subscription-expiry boundaries in Cairo time, and public clinic resolution. It passed against the connected database and rolls its fixture data back.
- `node scripts/browser-smoke.mjs <output-directory>` is an optional real-browser smoke test. It requires Playwright and Microsoft Edge.

See [START-HERE-AR.md](START-HERE-AR.md), [docs/PHASE2.md](docs/PHASE2.md), [docs/OWNER-PORTAL.md](docs/OWNER-PORTAL.md), and [docs/COMPETITIVE-BASELINE.md](docs/COMPETITIVE-BASELINE.md).
