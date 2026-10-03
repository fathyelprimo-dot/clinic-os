import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

import { provision, retryProvisionCleanup, cleanMedia, diagnostic } from "./operations.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function validId(value: unknown) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

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
    diagnostic("request");
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
      diagnostic("request");
      return reply(503, { error: "تعذر التحقق من صلاحية مالك المنصة." });
    }
    if (!allowed) return reply(403, { error: "هذا الحساب غير مفعّل كمالك للمنصة." });

    if (input.action === "list-owner-operations") {
      const [operations, receipts] = await Promise.all([
        admin.from("owner_provision_operations").select("id,state,clinic_slug,lease_until").eq("owner_id", userId).in("state", ["prepared", "cleanup_required"]).order("created_at", { ascending: false }).limit(50),
        admin.from("owner_deletion_receipts").select("id,confirmation_name").eq("owner_id", userId).eq("media_deleted", false).limit(50),
      ]);
      const missingMaintenanceTable = [operations.error, receipts.error].some((error) => {
        const message = error?.message?.toLowerCase?.() || "";
        return message.includes("does not exist") || message.includes("could not find the table") || message.includes("relation");
      });
      if (missingMaintenanceTable) {
        return reply(200, { operations: [], receipts: [] });
      }
      if (operations.error || receipts.error) return reply(503, { error: "تعذر تحميل العمليات غير المكتملة." });
      return reply(200, { operations: operations.data || [], receipts: receipts.data || [] });
    }
    if (input.action === "cleanup-provision") {
      if (!validId(input.operation_id)) return reply(400, { error: "معرّف العملية غير صالح." });
      try { return reply(200, await retryProvisionCleanup(admin, userId, input.operation_id)); }
      catch { diagnostic("retry-cleanup"); return reply(409, { error: "تعذر إعادة فحص العملية. انتظر انتهاء الدقيقتين ثم حاول مجددًا." }); }
    }
    if (input.action === "delete-clinic") {
      const clinicId = typeof input.clinic_id === "string" ? input.clinic_id : "";
      const confirmation = typeof input.confirmation === "string" ? input.confirmation.trim() : "";
      if (!validId(clinicId) || !confirmation) return reply(400, { error: "اكتب اسم العيادة أو رابطها كما يظهر لتأكيد الحذف." });

      const { data, error } = await admin.rpc("platform_admin_delete_clinic", {
        p_admin_user_id: userId,
        p_clinic_id: clinicId,
        p_confirmation: confirmation,
      });
      if (error) {
        const message = (error.message || "").toLowerCase();
        if (message.includes("confirmation_mismatch")) return reply(400, { error: "تأكيد الحذف غير مطابق. اكتب اسم العيادة أو الـ slug بالضبط." });
        if (message.includes("clinic_not_found")) return reply(404, { error: "العيادة غير موجودة أو تم حذفها بالفعل." });
        if (message.includes("not_platform_admin") || error.code === "42501") return reply(403, { error: "هذا الحساب لا يملك صلاحية حذف العيادات." });
        diagnostic("delete", error);
        return reply(409, { error: "تعذر حذف العيادة بأمان. لم يتم تنفيذ حذف جزئي." });
      }

      let mediaPending = false;
      try {
        const { data: files, error: listError } = await admin.storage.from("clinic-media").list(clinicId, { limit: 1000 });
        if (listError) throw listError;
        const paths = (files || []).filter((item) => item?.name).map((item) => clinicId + "/" + item.name);
        if (paths.length) {
          const { error: removeError } = await admin.storage.from("clinic-media").remove(paths);
          if (removeError) throw removeError;
        }
      } catch (storageError) {
        mediaPending = true;
        diagnostic("storage-cleanup", storageError);
      }

      return reply(200, { deleted: true, media_pending: mediaPending, clinic: data || null });
    }

    if (input.action === "cleanup-clinic-media") {
      if (!validId(input.operation_id)) return reply(400, { error: "معرّف العملية غير صالح." });
      try { await cleanMedia(admin, userId, input.operation_id); return reply(200, { deleted: true, media_pending: false }); }
      catch { diagnostic("storage-cleanup"); return reply(503, { deleted: true, media_pending: true, operation_id: input.operation_id, error: "تعذر تأكيد تنظيف ملفات الصور. حاول لاحقًا." }); }
    }

    if (input.action === "list-tenants") {
      const { data, error } = await admin.rpc("platform_admin_list_tenants", {
        p_admin_user_id: userId,
      });
      if (error) {
        diagnostic("request");
        return reply(500, { error: "تعذر تحميل العيادات حاليًا." });
      }
      return reply(200, { tenants: Array.isArray(data) ? data : [] });
    }

    if (input.action === "list-doctor-activation-requests") {
      const { data, error } = await admin.rpc("platform_admin_list_doctor_activation_requests", {
        p_admin_user_id: userId,
      });
      if (error) {
        diagnostic("request");
        return reply(500, { error: "تعذر تحميل طلبات تفعيل الأطباء." });
      }
      return reply(200, { requests: Array.isArray(data) ? data : [] });
    }

    if (input.action === "decide-doctor-activation") {
      const requestId = typeof input.request_id === "string" ? input.request_id : "";
      const decision = input.decision;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return reply(400, { error: "طلب التفعيل غير صالح." });
      }
      if (decision !== "approve" && decision !== "reject") {
        return reply(400, { error: "اختر قبول الطلب أو رفضه." });
      }
      const { data, error } = await admin.rpc("platform_admin_decide_doctor_activation_request", {
        p_admin_user_id: userId,
        p_request_id: requestId,
        p_decision: decision,
      });
      if (error) {
        diagnostic("request");
        return reply(409, { error: "تعذر تنفيذ القرار. حدّث الصفحة وتحقق من حالة الطلب." });
      }
      return reply(200, { result: data });
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
        diagnostic("request");
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
      if (input.is_active) {
        const { data: pendingRequest, error: pendingError } = await admin
          .from("doctor_activation_requests")
          .select("id")
          .eq("clinic_id", clinicId)
          .eq("status", "pending")
          .maybeSingle();
        if (pendingError) {
          diagnostic("request");
          return reply(503, { error: "تعذر التحقق من طلب تفعيل الطبيب." });
        }
        if (pendingRequest) {
          return reply(409, { error: "راجع طلب تفعيل الطبيب واختر القبول أو الرفض أولًا." });
        }
      }
      const { error } = await admin.rpc("platform_admin_set_clinic_active", {
        p_admin_user_id: userId,
        p_clinic_id: clinicId,
        p_is_active: input.is_active,
      });
      if (error) {
        diagnostic("request");
        return reply(400, { error: "تعذر تحديث حالة العيادة. راجعها وحاول مرة أخرى." });
      }
      return reply(200, { ok: true, is_active: input.is_active });
    }

    if (input.action === "list-change-requests") {
      const { data, error } = await admin.rpc("platform_admin_list_change_requests", {
        p_admin_user_id: userId,
      });
      if (error) {
        diagnostic("request");
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
        diagnostic("request");
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
        diagnostic("request");
        return reply(400, { error: "تعذر تحديث الطلب. حاول مرة أخرى." });
      }
      return reply(200, { ok: true });
    }

    if (input.action !== "create-tenant") return reply(400, { error: "الإجراء غير معروف." });

    const clinic = input.clinic;
    const services = input.services;
    const initialPassword = input.initial_password;
    if (!clinic || typeof clinic !== "object" || Array.isArray(clinic) || !Array.isArray(services)) {
      return reply(400, { error: "راجع بيانات العيادة والخدمات." });
    }
    if (typeof initialPassword !== "string" || initialPassword.length < 12 || initialPassword.length > 128) {
      return reply(400, { error: "كلمة المرور الأولية يجب أن تكون من ١٢ إلى ١٢٨ حرفًا." });
    }

    const doctorEmail = typeof clinic.doctor_email === "string" ? clinic.doctor_email.trim().toLowerCase() : "";
    const doctorName = typeof clinic.doctor_name === "string" ? clinic.doctor_name.trim() : "";
    if (!doctorEmail || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(doctorEmail)) {
      return reply(400, { error: "اكتب بريد الدكتور الإلكتروني بشكل صحيح." });
    }
    if (doctorName.length < 2 || doctorName.length > 100) {
      return reply(400, { error: "اكتب اسم الدكتور بشكل صحيح." });
    }
    if (services.length < 1 || services.length > 20) {
      return reply(400, { error: "أضف خدمة واحدة على الأقل وبحد أقصى ٢٠ خدمة." });
    }

    async function findAuthUserByEmail(email: string) {
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const found = data.users.find((item) => (item.email || "").toLowerCase() === email);
        if (found) return found;
        if (data.users.length < 1000) break;
      }
      return null;
    }

    async function existingUserIsLinked(existingUserId: string) {
      const [membership, patient, platformAdmin, activation] = await Promise.all([
        admin.from("memberships").select("clinic_id").eq("user_id", existingUserId).limit(1),
        admin.from("patients").select("id").eq("user_id", existingUserId).limit(1),
        admin.from("platform_admins").select("user_id").eq("user_id", existingUserId).limit(1),
        admin.from("doctor_activation_requests").select("id").eq("doctor_user_id", existingUserId).limit(1),
      ]);
      const queryError = membership.error || patient.error || platformAdmin.error || activation.error;
      if (queryError) throw queryError;
      return Boolean(
        membership.data?.length ||
        patient.data?.length ||
        platformAdmin.data?.length ||
        activation.data?.length
      );
    }

    let doctorUser = await findAuthUserByEmail(doctorEmail);
    let createdNewUser = false;

    if (doctorUser) {
      if (await existingUserIsLinked(doctorUser.id)) {
        return reply(409, { error: "بريد الدكتور مستخدم بالفعل في حساب مرتبط بالنظام. استخدم بريدًا آخر أو عدّل الحساب الموجود." });
      }
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(doctorUser.id, {
        password: initialPassword,
        email_confirm: true,
        user_metadata: { ...(doctorUser.user_metadata || {}), full_name: doctorName },
      });
      if (updateError || !updated.user) {
        diagnostic("reuse-auth-user", updateError);
        return reply(409, { error: "وجدنا حسابًا قديمًا بهذا البريد لكن تعذر إعادة تجهيزه. جرّب بريدًا آخر أو احذف الحساب القديم من Auth." });
      }
      doctorUser = updated.user;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: doctorEmail,
        password: initialPassword,
        email_confirm: true,
        user_metadata: { full_name: doctorName },
      });
      if (createError || !created.user) {
        diagnostic("create-auth-user", createError);
        if (createError?.code === "email_exists" || createError?.code === "email_address_exists") {
          return reply(409, { error: "بريد الدكتور مسجّل بالفعل. أعد المحاولة؛ إذا كان الحساب غير مرتبط سيُعاد استخدامه تلقائيًا." });
        }
        return reply(400, { error: "تعذر إنشاء حساب الدكتور. راجع البريد وكلمة المرور وحاول مرة أخرى." });
      }
      doctorUser = created.user;
      createdNewUser = true;
    }

    const { data, error } = await admin.rpc("platform_admin_create_tenant_pending", {
      p_admin_user_id: userId,
      p_doctor_user_id: doctorUser.id,
      p_data: { ...clinic, doctor_email: doctorEmail, doctor_name: doctorName },
      p_services: services,
    });

    if (error) {
      if (createdNewUser) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(doctorUser.id);
        if (cleanupError) diagnostic("create-cleanup", cleanupError);
      }
      const message = error.message || "";
      if (/duplicate key|already in use/i.test(message)) {
        return reply(409, { error: "رابط العيادة أو إحدى البيانات مستخدمة بالفعل. غيّر رابط العيادة وحاول مرة أخرى." });
      }
      diagnostic("create-tenant", error);
      return reply(400, { error: "تعذر إنشاء العيادة. راجع البيانات والخدمات وحاول مرة أخرى." });
    }

    return reply(201, {
      tenant: data,
      account_created: createdNewUser,
      account_reused: !createdNewUser,
      activation_status: "pending",
    });
  } catch {
    diagnostic("unhandled");
    return reply(500, { error: "تعذر إتمام العملية. أعد فحص الحالة قبل المحاولة مجددًا." });
  }
});
