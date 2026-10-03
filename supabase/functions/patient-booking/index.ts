import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.99.1';
import { hash, limitHash, validPushSubscription } from '../_shared/push.ts';

const origins = new Set((Deno.env.get('PATIENT_APP_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean));
Deno.serve(async request => {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'apikey, content-type, authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (!origins.has(origin)) return reply(403, { message: 'هذا الموقع غير مسموح له.' });
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply(405, {});
  const secret = Deno.env.get('PATIENT_RATE_LIMIT_SECRET');
  if (!secret) return reply(503, { message: 'خدمة الحجز غير جاهزة حاليًا.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // The gateway's client-IP header must be overwritten by the trusted ingress, never supplied by clients.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { data: ipAllowed, error: ipError } = await admin.rpc('consume_patient_limit', { p_key: await limitHash('ip:' + ip, secret), p_max: 100 });
    if (ipError || !ipAllowed) return reply(429, { message: 'طلبات كثيرة. حاول بعد قليل.' });
    const raw = await request.text();
    if (raw.length > 12000) return reply(400, { message: 'الطلب غير صالح.' });
    const input = JSON.parse(raw);
    if (input.action === 'config') return reply(200, { publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '' });
    const token = typeof input.token === 'string' ? input.token : '';
    const clinicId = input.clinic_id;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(clinicId || '')) return reply(400, { message: 'الطلب غير صالح.' });
    const tokenHash = await hash(token);
    if (input.action === 'book') {
      const args = input.booking;
      if (!args || !/^01[0125]\d{8}$/.test(args.p_phone || '')) return reply(400, { message: 'راجع رقم الموبايل.' });
      // A single committed limiter transaction remains effective even when booking fails.
      const { data: allowed, error } = await admin.rpc('consume_patient_limit', { p_key: await limitHash('book:' + clinicId + ':' + args.p_phone, secret), p_max: 5 });
      if (error || !allowed) return reply(429, { message: 'وصلت إلى حد محاولات الحجز. حاول لاحقًا.' });
      const { data, error: bookingError } = await admin.rpc('guest_book_appointment', {
        p_clinic: clinicId, p_service: args.p_service, p_name: args.p_name, p_phone: args.p_phone,
        p_date: args.p_date, p_time: args.p_time, p_payment: args.p_payment, p_travel: args.p_travel,
        p_consent: args.p_consent === true, p_request: args.p_request, p_token_hash: tokenHash,
      });
      if (bookingError) return reply(409, { message: bookingError.message.includes('Slot unavailable') ? 'الدور اتْحجز بالفعل. اختار دورًا آخر.' : 'تعذر الحجز. راجع الموعد والبيانات وحاول مرة أخرى.' });
      return reply(200, { booking: data });
    }
    const { data: capability, error: capError } = await admin.from('booking_capabilities').select('appointment_id').eq('clinic_id', clinicId).eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (capError || !capability) return reply(404, { message: 'تعذر الوصول للحجز. تواصل مع الاستقبال.' });
    const { data: active, error: activeError } = await admin.from('clinics').select('id').eq('id', clinicId).eq('is_active', true).maybeSingle();
    const { data: subscription, error: subscriptionError } = await admin.from('clinic_subscriptions').select('ends_on').eq('clinic_id', clinicId).maybeSingle();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (activeError || subscriptionError || !active || (subscription?.ends_on && subscription.ends_on < today)) return reply(404, { message: 'العيادة غير متاحة حاليًا.' });
    const { data: booking, error: readError } = await admin.from('appointments').select('id,clinic_id,status,triage,arrived,scheduled_at,service_name,duration_minutes,paid,travel_minutes,notification_consent').eq('id', capability.appointment_id).eq('clinic_id', clinicId).single();
    if (readError || !booking) return reply(404, { message: 'تعذر الوصول للحجز.' });
    if (input.action === 'track') {
      const { data: eta, error } = await admin.rpc('guest_booking_eta', { p_clinic: clinicId, p_appointment: booking.id });
      if (error) return reply(503, { message: 'تعذر تحديث الدور.' });
      return reply(200, { booking: { ...booking, eta } });
    }
    if (input.action !== 'subscribe' || !booking.notification_consent || !validPushSubscription(input.subscription)) return reply(400, { message: 'اشتراك التنبيهات غير صالح أو لم توافق على التنبيهات أثناء الحجز.' });
    const { data: subAllowed } = await admin.rpc('consume_patient_limit', { p_key: await limitHash('sub:' + tokenHash, secret), p_max: 10 });
    if (!subAllowed) return reply(429, { message: 'طلبات كثيرة. حاول لاحقًا.' });
    const { error } = await admin.from('push_subscriptions').upsert({ clinic_id: clinicId, appointment_id: booking.id, endpoint_hash: await hash(input.subscription.endpoint), subscription: input.subscription }, { onConflict: 'appointment_id,endpoint_hash' });
    if (error) return reply(503, { message: 'تعذر حفظ اشتراك التنبيهات. حاول مجددًا.' });
    const { data: patient } = await admin.from('appointments').select('patient_id').eq('id', booking.id).single();
    const { error: noticeError } = await admin.from('notifications').upsert({ clinic_id: clinicId, appointment_id: booking.id, patient_id: patient!.patient_id, kind: 'confirmation', message: 'تم تأكيد حجزك. تابع الدور والوقت المتوقع من العيادة.', dedupe_key: '' }, { onConflict: 'appointment_id,kind,dedupe_key', ignoreDuplicates: true });
    if (noticeError) return reply(503, { message: 'تم حفظ الاشتراك، لكن تعذر تجهيز تأكيد الحجز. حاول مجددًا.' });
    return reply(200, { ok: true });
  } catch { return reply(503, { message: 'تعذر إتمام الطلب حاليًا. حاول مرة أخرى.' }); }
});
