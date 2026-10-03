import type { SupabaseClient } from "npm:@supabase/supabase-js@2.99.1";

type Operation = { id: string; owner_id: string; doctor_user_id: string; clinic_id: string; state: string; lease_token: string };
export function diagnostic(stage: string, error?: { code?: string; status?: number } | null) {
  // Only classification codes: never payloads, passwords, email, tokens or raw messages.
  console.error(JSON.stringify({ component: "owner-admin", stage, code: error?.code, status: error?.status }));
}
async function completed(admin: SupabaseClient, op: Operation) {
  const { data, error } = await admin.from("clinics").select("id,slug,name").eq("id", op.clinic_id).single();
  if (error) throw error;
  return { tenant: data, account_created: true, activation_status: "pending" };
}
async function compensate(admin: SupabaseClient, owner: string, op: Operation) {
  const { data, error } = await admin.rpc("owner_cancel_tenant", { p_owner: owner, p_request: op.id, p_lease: op.lease_token });
  if (error) throw error; // Unknown transaction outcome: do not delete a potentially linked account.
  if (data.state === "completed") return completed(admin, data);
  const { error: deletion } = await admin.auth.admin.deleteUser(op.doctor_user_id);
  if (deletion && deletion.code !== "user_not_found" && deletion.status !== 404) throw deletion;
  const { error: finish } = await admin.from("owner_provision_operations").update({ state: "failed", updated_at: new Date().toISOString() })
    .eq("id", op.id).eq("owner_id", owner).eq("lease_token", op.lease_token).eq("state", "cleanup_required");
  if (finish) throw finish;
  return null;
}
type ProvisionInput = { initial_password?: unknown; operation_id: string; clinic?: Record<string, unknown>; services: unknown };
export async function provision(admin: SupabaseClient, owner: string, input: ProvisionInput) {
  const password = input.initial_password;
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return { status: 400, body: { error: "كلمة المرور الأولية يجب أن تكون من ١٢ إلى ١٢٨ حرفًا." } };
  }
  const clinic: Record<string, unknown> & { doctor_email: string } = { ...input.clinic, doctor_email: String(input.clinic?.doctor_email || "").trim().toLowerCase() };
  const { data: op, error: prepare } = await admin.rpc("owner_prepare_tenant", {
    p_owner: owner, p_request: input.operation_id, p_data: clinic, p_services: input.services,
  });
  if (prepare) {
    diagnostic("prepare", prepare);
    const message = prepare.message || "";
    return { status: 409, body: { error: /already in use|duplicate key/i.test(message) ? "رابط العيادة مستخدم بالفعل. اختر رابطًا مختلفًا." : /in progress/i.test(message) ? "العملية قيد التنفيذ. انتظر قليلًا قبل إعادة المحاولة بنفس الطلب." : "لم يتم إنشاء أي حساب. راجع البيانات وتأكد من تطبيق Migration المطلوبة.", operation_id: input.operation_id } };
  }
  if (op.state === "completed") return { status: 200, body: await completed(admin, op) };
  try {
    // A persisted, server-generated UUID makes even an interrupted Auth request recoverable.
    if (op.state !== "prepared") throw { code: "cleanup_required" };
    const { error: authError } = await admin.auth.admin.createUser({ id: op.doctor_user_id,
      email: clinic.doctor_email, password, email_confirm: true, user_metadata: { full_name: clinic.doctor_name } });
    if (authError) throw authError;
    const { data, error } = await admin.rpc("owner_complete_tenant", {
      p_owner: owner, p_request: op.id, p_lease: op.lease_token, p_data: clinic, p_services: input.services,
    });
    if (error) throw error;
    return { status: 201, body: { tenant: data, account_created: true, activation_status: "pending" } };
  } catch (error) {
    const failure = error as { code?: string; status?: number };
    diagnostic("provision", failure);
    try {
      const recovered = await compensate(admin, owner, op);
      if (recovered) return { status: 200, body: recovered };
      return { status: 409, body: { error: failure.code === "email_exists" || failure.code === "email_address_exists" ? "بريد الدكتور مسجّل بالفعل. استخدم بريدًا غير مستخدم؛ لم تتم إضافة العيادة." : "لم تكتمل إضافة العيادة، وتم التراجع عن الحساب الجديد. راجع البيانات وسياسة كلمة المرور.", operation_id: op.id, retry_new: true } };
    } catch (cleanup) {
      diagnostic("compensation", cleanup as { code?: string });
      return { status: 503, body: { error: "تعذر تأكيد اكتمال العملية أو تنظيف الحساب. لا تنشئ طلبًا جديدًا؛ استخدم إعادة فحص العملية بعد دقيقتين.", operation_id: op.id, cleanup_pending: true } };
    }
  }
}
export async function retryProvisionCleanup(admin: SupabaseClient, owner: string, id: string) {
  const { data: op, error } = await admin.rpc("owner_acquire_cleanup", { p_owner: owner, p_request: id });
  if (error) throw error;
  const result = await compensate(admin, owner, op);
  return result || { cleaned: true };
}
export async function cleanMedia(admin: SupabaseClient, owner: string, id: string) {
  const { data: receipt, error } = await admin.from("owner_deletion_receipts").select("storage_paths,media_deleted")
    .eq("id", id).eq("owner_id", owner).single();
  if (error) throw error;
  if (!receipt.media_deleted) {
    for (let i = 0; i < receipt.storage_paths.length; i += 100) {
      const { error } = await admin.storage.from("clinic-media").remove(receipt.storage_paths.slice(i, i + 100));
      if (error) throw error;
    }
    const { error } = await admin.from("owner_deletion_receipts").update({ media_deleted: true }).eq("id", id).eq("owner_id", owner);
    if (error) throw error;
  }
}
