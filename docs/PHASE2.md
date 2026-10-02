# Phase 2 — implementation, activation, and verification

Clinic OS preserves the original navy/teal visual foundation and Arabic RTL experience. This document separates code already present from live services that still need configuration.

## Implemented

| Area | Current behavior |
|---|---|
| Services | Doctor-managed service name, category (normal/urgent/emergency/follow-up), price, duration, priority, and active state |
| Booking | Public booking after phone OTP; patient tracking is by verified phone identity and does not expose appointment codes |
| Queue and ETA | Transaction-locked booking/queue actions, arrival and triage controls, adaptive statistical estimates formatted as days/hours/minutes |
| Clinic profile | Doctor name/photo, tagline/about, three theme presets, accent color, Google Maps link/address, work hours, buffer, and payment destinations |
| Payment records | Cash, InstaPay, and mobile-wallet options; staff must manually confirm receipt. No card/mobile payment gateway is connected |
| Clinical records | Tenant-scoped patient contacts; doctor-only medical history, allergies, diagnosis, notes, medications, and printable prescriptions |
| Roles | Supabase Auth; server-side doctor/reception membership; reception cannot read clinical records or change doctor-only settings |
| Multi-tenancy | Tenant-scoped RLS, composite foreign keys, manual clinic slugs, verified custom-domain resolution, owner provisioning and activation tools |
| Realtime | Authenticated Postgres Changes with tenant filters, reconnect and refresh fallback |
| Storage | Durable business records are in PostgreSQL. The active app does not write patient data or auth tokens to localStorage/sessionStorage/IndexedDB |
| Owner portal | Create/edit clinic profile, set manual slug, configure supported service and branding fields, invite doctor, upload clinic photo, set subscription end, suspend/restore clinic, review change requests |

ETA is an adaptive statistical estimate based on appointment duration, recent completed visits, service priority, queue state, and arrival buffer. It is not a trained AI model or live traffic prediction. Emergency bookings wait for doctor review; they do not automatically interrupt an ongoing visit.

## Newly enforced tenant access rules

The production database now includes `private.clinic_access_enabled(clinic_id)`. It requires the clinic to be manually active and either have no subscription end date or have `ends_on` on/after the current date in `Africa/Cairo`. The guard now applies to public clinic resolution and slot availability, business-data RLS policies, queue and settings writes, clinical-record writes, media access, and reminder generation/claiming.

This means the owner can stop tenant access immediately, existing logged-in staff sessions cannot keep reading clinic records, and an expired subscription stops access after its recorded Cairo-local end date. The owner dashboard shows effective availability, expiring subscriptions, and expired subscriptions separately. The owner can still inspect and renew a subscription or toggle manual activation.

## Live activation state

- Supabase project: `xgowtcloqiivxeqhgndr`.
- 15 migrations are currently applied to production; six original migrations and the newly added suspension/expiry migration are in this repository.
- Eight previously applied owner/onboarding/tenant migrations are missing from the repository. Their production migration versions also differ from older local migration filenames. Reconcile this before using Supabase CLI to rebuild a fresh environment or push migrations; do not blindly replay the older SQL.
- The Site owner's email is now on the bootstrap allowlist, but no platform-admin Auth account has claimed it yet. The live project has no clinic tenant, doctor membership, or real service catalog.
- The hosted public URL is still on Site version 8 and is not automatically built from this GitHub repository. A successful GitHub Actions run does not mean the hosted URL was updated.
- The owner can request the secure activation email from `/owner.html`. No real doctor account, SMS provider, external reminder adapter/cron, online-payment provider, or custom DNS domain is configured.

## Data persistence and security boundary

| Data | Source of truth | Browser behavior |
|---|---|---|
| Appointments and queue | `appointments`; transactional RPCs | Loaded from Supabase; short-lived in-memory rendering only |
| Patient contacts | `patients` | Tenant-scoped, paginated reads; no browser persistence |
| Payments | `payments` plus audited staff action | Receipt confirmation is a separate staff action |
| Clinical records | `medical_records` and `encounters` | Doctor-only server queries and write RPC |
| Services/profile | `services` and `clinics` | Tenant resolution and doctor/admin controls |
| Reminders | `notifications` and delivery queue | In-app state plus optional server-side external delivery |
| Staff/patient auth | Supabase Auth and memberships | Tokens remain in JavaScript memory and must be re-established on reload |

The publishable Supabase key is intentionally public. Never expose a service-role/secret key in client code. RLS and server-side role checks are the authorization boundary; domain names and URL slugs only resolve clinic branding.

## Notifications and payments

The database can create consented in-app reminders. External SMS/WhatsApp delivery requires a scheduled worker, `DISPATCH_SECRET`, a contracted HTTPS provider endpoint, provider token, and idempotent delivery receipts. None is configured now. Selecting Cash/InstaPay/wallet is not proof of payment; staff confirms receipt in the clinic portal. Online card/payment collection, automatic refunds, and reconciliation are not present.

## Validation performed

- `supabase/tests/tenant_roles.sql` ran against the connected Supabase project and passed, then rolled back its fixture users and rows. It now checks tenant/role isolation, manual suspension, access through the subscription end date, denial the next Cairo day, and public clinic resolution.
- The local GitHub workflow previously passed 43 checks at commit `97c8431`. This update adds two regression checks; the expected suite is 45 after CI runs.
- The optional browser smoke test now reflects the no-booking-code journey. A real Playwright/Edge run has not been completed in this workspace.
- Current GitHub Actions results: https://github.com/fathyelprimo-dot/clinic-os/actions

## Still missing from the product

- A page builder to edit every patient-facing string and freely reorder/show/hide all sections. Current owner controls cover only the supported clinic fields and three predefined themes.
- Automated cancellation waitlist and one-click rebooking.
- Configured SMS/WhatsApp provider and delivery scheduling.
- Integrated online payment gateway and refund/reconciliation workflow.
- Telehealth, secure patient messaging, patient-submitted forms, insurance search, public ratings/reviews, and marketplace discovery.
- Flexible multi-shift clinic schedules; current clinic schedule is one daily opening window.
- Production owner/doctor setup and a published Site version connected to GitHub main.

For the competitor-backed roadmap see [COMPETITIVE-BASELINE.md](COMPETITIVE-BASELINE.md). For creating tenants and managing clinics see [OWNER-PORTAL.md](OWNER-PORTAL.md).
