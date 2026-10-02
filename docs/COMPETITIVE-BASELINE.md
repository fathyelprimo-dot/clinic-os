# Competitive baseline — 2 October 2026

This is a feature comparison, not a claim that Clinic OS is stronger overall. Clinic OS is currently a white-label clinic operating tool with a local Egyptian booking/queue focus; products such as Vezeeta are also patient-discovery marketplaces.

## What Clinic OS already differentiates

- Each clinic can have its own manually chosen slug and supported branding, rather than being only a profile inside a marketplace.
- Egyptian phone-first booking, phone-verified tracking without booking codes, cash/InstaPay/wallet recording, and an Arabic RTL patient journey.
- Priority-aware waiting list with an adaptive queue ETA and arrival/travel buffer.
- Doctor-only records and separate doctor/reception permissions with Supabase RLS.
- Platform-owner clinic activation and subscription controls, including server-enforced suspension/expiry.

These are valuable differentiators once a real clinic, doctor account, provider integrations, and current production deployment are activated.

## Where established products currently go further

| Product | Publicly documented capabilities | Gap for Clinic OS |
|---|---|---|
| Cliniko | Online booking, telehealth appointment types, prepayment via Stripe, automated email/SMS reminders, and patient forms | No connected payment gateway, telehealth workflow, external SMS provider, or booking forms |
| NexHealth | One-click waitlist acceptance by text/email when slots open; communications and practice-management integrations | No automated cancellation waitlist, patient communication delivery, or practice-system integrations |
| Vezeeta | Doctor discovery in Egypt, insurance filters, patient reviews/ratings, appointment booking, and pay-at-clinic flow | Clinic OS does not provide a public doctor marketplace, insurance directory, or verified review network |
| Doctolib | Telehealth, patient messaging, and clinical software for observations, treatment, and prescriptions | Clinic OS has doctor-only records and printable prescriptions, but no telehealth or secure patient messaging |

## Recommended build order

1. **Activate the foundations:** provision the platform owner and first tenant, reconcile the eight missing production migrations, connect the hosted Site to the repository, and verify patient OTP.
2. **Close appointment gaps:** add a consent-based cancellation waitlist with atomic slot claiming, cancellation links, and one-click patient confirmation.
3. **Make reminders real:** add a selected Egyptian SMS/WhatsApp provider, delivery receipts, failure retries, patient opt-out controls, and the scheduled worker.
4. **Add safe payment collection:** choose a licensed payment provider that supports the target market, then implement payment links, webhook verification, refunds, and reconciliation. InstaPay/mobile-wallet labels must remain manual until that provider flow exists.
5. **Finish white-label control:** add a persisted section editor for patient-facing content, visibility, and order, with preview and mobile layout checks. Keep clinical and consent wording locked behind reviewed translations.
6. **Expand the care journey:** patient forms, telehealth, secure follow-up, insurance data, and verified reviews only after clinic operations and data/privacy workflows are ready.
7. **Prove quality at scale:** run two-tenant isolation tests, booking race tests, phone delivery tests, and real-device accessibility checks before marketing comparative claims.

## Sources

Official product pages checked on 2 October 2026:

- [Cliniko: online bookings overview](https://help.cliniko.com/en/articles/1023955-a-quick-overview-of-online-bookings)
- [Cliniko: telehealth](https://help.cliniko.com/en/collections/2219158-telehealth)
- [Cliniko: online payments](https://help.cliniko.com/en/collections/2219294-online-payments)
- [NexHealth: Waitlist](https://www.nexhealth.com/features/waitlist)
- [NexHealth: waitlist requests](https://help.nexhealth.com/en/articles/10046719-how-do-i-send-waitlist-requests)
- [Vezeeta Egypt](https://www.vezeeta.com/en)
- [Vezeeta doctor discovery and reviews](https://www.vezeeta.com/en/doctor/all-specialities/egypt/health-care-fund)
- [Doctolib health professionals](https://about.doctolib.com/health-professionals/)
