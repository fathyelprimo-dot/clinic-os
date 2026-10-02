import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://clinic-os.fathyelprimo.workers.dev",
  "https://clinic-os-elprimo.violaelprimo.chatgpt.site",
  ...(Deno.env.get("OWNER_BOOTSTRAP_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function reply(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigins.has(origin)) return new Response("Forbidden", { status: 403, headers: { Vary: "Origin" } });
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return reply(405, { ok: false }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Owner bootstrap environment is missing.");
    return reply(500, { ok: false }, origin);
  }

  const input = await request.json().catch(() => null);
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) || email.length > 254) {
    return reply(200, { ok: true }, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: allowed, error: allowlistError } = await admin.rpc("platform_admin_is_bootstrap_email", {
      p_email: email,
    });
    if (allowlistError) {
      console.error("Owner bootstrap allowlist lookup failed:", allowlistError.message);
      return reply(200, { ok: true }, origin);
    }
    if (allowed !== true) return reply(200, { ok: true }, origin);

    const redirectTo = new URL("/owner.html?owner=1", origin).toString();
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: "Clinic OS Platform Owner" },
    });
    if (inviteError) console.error("Owner invitation could not be sent:", inviteError.message);
    // Keep the response the same for allowlisted and non-allowlisted emails.
    return reply(200, { ok: true }, origin);
  } catch (error) {
    console.error("Owner bootstrap request failed:", error);
    return reply(200, { ok: true }, origin);
  }
});
