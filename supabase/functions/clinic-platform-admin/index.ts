import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey =
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    (() => {
      const keys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
      return keys ? JSON.parse(keys).default : "";
    })();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error("Required Supabase function environment is missing.");
    return reply(500, { error: "إعدادات الخدمة غير مكتملة. راجع إعدادات Supabase." });
  }

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "سجّل الدخول أولًا." });

  const caller = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return reply(401, { error: "انتهت الجلسة. سجّل الدخول مرة أخرى." });
    const userId = userData.user.id;

    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return reply(400, { error: "الطلب غير صالح." });
    }

    if (input.action === "claim-owner") {
      if (!userData.user.email_confirmed_at) {
        return reply(403, { error: "افتح رابط تأكيد البريد قبل تفعيل حساب المالك." });
      }
      const { data: claimed, error: claimError } = await admin.rpc("platform_admin_claim_owner", {
        p_user_id: userId,
      });
      if (claimError || claimed !== true) {
        return reply(403, { error: "هذا البريد غير مفعّل كمالك للمنصة." });
      }
      return reply(200, { owner: true, email: userData.user.email || "" });
    }

    const { data: allowed, error: accessError } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (accessError) {
      console.error("Platform admin lookup failed:", accessError.message);
      return reply(503, { error: "تعذر التحقق من صلاحية مالك المنصة." });
    }
    if (!allowed) return reply(403, { error: "هذا الحساب غير مفعّل كمالك للمنصة." });

    if (input.action === "list-tenants") {
      const { data, error } = await admin.rpc("platform_admin_list_tenants", {
        p_admin_user_id: userId,
      });
      if (error) {
        console.error("Tenant list failed:", error.message);
        return reply(500, { error: "تعذر تحميل العيادات حاليًا." });
      }
      return reply(200, { tenants: Array.isArray(data) ? data : [] });
    }

    if (input.action === "update-clinic") {
      const clinicId = typeof input.clinic_id === "string" ? input.clinic_id : "";
      const clinic = input.clinic;
      const services = input.services;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
        return reply(400, { error: "معرّف العيادة غير صالح." });
      }
      if (!clinic || typeof clinic !== "object" || Array.isArray(clinic) || !Array.isArray(services) || services.length < 1 || services.length > 20) {
        return reply(400, { error: "راجع بيانات العيادة وقائمة الخدمات." });
      }
      const { error } = await admin.rpc("platform_admin_update_clinic", {
        p_admin_user_id: userId,
        p_clinic_id: clinicId,
        p_data: clinic,
        p_services: services,
      });
      if (error) {
        const message = error.message || "";
        if (message.toLowerCase().includes("duplicate key") || message.toLowerCase().includes("already in use")) {
          return reply(409, { error: "رابط العيادة مستخدم بالفعل. اختار رابطًا مختلفًا." });
        }
        console.error("Clinic customization failed:", message);
        return reply(400, { error: "تعذر حفظ التخصيص. راجع البيانات والخدمات وحاول مرة أخرى." });
      }
      return reply(200, { ok: true });
    }

    if (input.action === "set-clinic-active") {
      const clinicId = typeof input.clinic_id === "string" ? input.clinic_id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
        return reply(400, { error: "معرّف العيادة غير صالح." });
      }
      if (typeof input.is_active !== "boolean") {
        return reply(400, { error: "حالة العيادة غير صالحة." });
      }
      const { error } = await admin.rpc("platform_admin_set_clinic_active", {
        p_admin_user_id: userId,
        p_clinic_id: clinicId,
        p_is_active: input.is_active,
      });
      if (error) {
        console.error("Clinic activation update failed:", error.message);
        return reply(400, { error: "تعذر تحديث حالة العيادة. راجعها وحاول مرة أخرى." });
      }
      return reply(200, { ok: true, is_active: input.is_active });
    }

    if (input.action === "list-change-requests") {
      const { data, error } = await admin.rpc("platform_admin_list_change_requests", {
        p_admin_user_id: userId,
      });
      if (error) {
        console.error("Change request list failed:", error.message);
        return reply(500, { error: "تعذر تحميل طلبات التعديل حاليًا." });
      }
      return reply(200, { requests: Array.isArray(data) ? data : [] });
    }

    if (input.action === "update-subscription") {
      const clinicId = typeof input.clinic_id === "string" ? input.clinic_id : "";
      const endsOn = input.ends_on === null || input.ends_on === "" ? null : input.ends_on;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
        return reply(400, { error: "معرّف العيادة غير صالح." });
      }
      if (endsOn !== null) {
        if (typeof endsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
          return reply(400, { error: "اختار تاريخ انتهاء اشتراك صحيحًا." });
        }
        const parsedDate = new Date(endsOn + "T00:00:00.000Z");
        if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== endsOn) {
          return reply(400, { error: "اختار تاريخ انتهاء اشتراك صحيحًا." });
        }
      }
      const { error } = await admin.rpc("platform_admin_set_subscription", {
        p_admin_user_id: userId,
        p_clinic_id: clinicId,
        p_ends_on: endsOn,
      });
      if (error) {
        console.error("Subscription update failed:", error.message);
        return reply(400, { error: "تعذر حفظ تاريخ الاشتراك. راجع العيادة وحاول مرة أخرى." });
      }
      return reply(200, { ok: true, ends_on: endsOn });
    }

    if (input.action === "update-change-request") {
      const requestId = typeof input.request_id === "string" ? input.request_id : "";
      const status = input.status;
      const ownerNote = typeof input.owner_note === "string" ? input.owner_note : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return reply(400, { error: "معرّف الطلب غير صالح." });
      }
      if (typeof status !== "string" || !new Set(["open", "in_progress", "resolved"]).has(status) || ownerNote.length > 4000) {
        return reply(400, { error: "راجع حالة الطلب أو ملاحظة المالك." });
      }
      const { error } = await admin.rpc("platform_admin_update_change_request", {
        p_admin_user_id: userId,
        p_request_id: requestId,
        p_status: status,
        p_owner_note: ownerNote,
      });
      if (error) {
        console.error("Change request update failed:", error.message);
        return reply(400, { error: "تعذر تحديث الطلب. حاول مرة أخرى." });
      }
      return reply(200, { ok: true });
    }

    if (input.action !== "create-tenant") return reply(400, { error: "الإجراء غير معروف." });

    const clinic = input.clinic;
    const services = input.services;
    if (!clinic || typeof clinic !== "object" || !Array.isArray(services)) {
      return reply(400, { error: "أكمل بيانات العيادة والخدمات." });
    }
    const doctorEmail = cleanEmail(clinic.doctor_email);
    const doctorName = typeof clinic.doctor_name === "string" ? clinic.doctor_name.trim() : "";
    const origin = request.headers.get("Origin");
    let siteOrigin: string;
    try {
      const parsedOrigin = new URL(origin || "");
      if (parsedOrigin.protocol !== "https:" && parsedOrigin.hostname !== "localhost") {
        return reply(400, { error: "رابط الدعوة لازم يكون HTTPS." });
      }
      siteOrigin = parsedOrigin.origin;
    } catch {
      return reply(400, { error: "رابط الموقع غير صالح لإرسال الدعوة." });
    }
    if (!doctorEmail || doctorName.length < 2 || doctorName.length > 100) {
      return reply(400, { error: "اكتب اسم الدكتور وبريده الإلكتروني." });
    }
    const invitationRedirect = new URL("/clinic/index.html", siteOrigin);
    invitationRedirect.searchParams.set("clinic", String(clinic.slug || ""));
    invitationRedirect.searchParams.set("portal", "doctor");

    // Create an invitation first. If the database transaction fails, remove this
    // newly-created auth user so no unused account remains behind.
    const { data: invitation, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(doctorEmail, {
        data: { full_name: doctorName },
        redirectTo: invitationRedirect.toString(),
      });
    if (inviteError || !invitation.user) {
      if (inviteError?.message?.toLowerCase().includes("redirect")) {
        return reply(400, { error: "أضف رابط الموقع إلى قائمة التحويل المسموحة في إعدادات Supabase Auth، ثم أعد إرسال الدعوة." });
      }
      return reply(400, {
        error: inviteError?.message?.toLowerCase().includes("already")
          ? "بريد الدكتور مسجّل بالفعل. استخدم دعوة جديدة ببريد غير مستخدم."
          : "تعذر إرسال دعوة الدكتور. راجع إعدادات البريد في Supabase.",
      });
    }

    const { data, error } = await admin.rpc("platform_admin_create_tenant", {
      p_admin_user_id: userId,
      p_doctor_user_id: invitation.user.id,
      p_data: { ...clinic, doctor_email: doctorEmail },
      p_services: services,
    });
    if (error) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(invitation.user.id);
      if (cleanupError) console.error("Invitation cleanup failed:", cleanupError.message);
      const message = error.message || "";
      if (message.includes("already in use")) {
        return reply(409, { error: "رابط العيادة مستخدم بالفعل. اختار اسم رابطًا آخر." });
      }
      console.error("Tenant creation failed:", message);
      return reply(400, { error: "لم تكتمل إضافة العيادة. راجع الحقول وحاول مرة أخرى." });
    }
    return reply(201, { tenant: data, invite_sent: true });
  } catch (error) {
    console.error("Platform admin request failed:", error);
    return reply(500, { error: "حدث عطل مؤقت. حاول مرة أخرى." });
  }
});
