import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
const reasonValid = (v: unknown): v is string => typeof v === "string" && v.trim().length >= 4 && v.trim().length <= 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const allowlist = (Deno.env.get("ADMIN_EMAILS") ?? "aminafshar5911@gmail.com").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!supabaseUrl || !anonKey || !serviceRoleKey || allowlist.length === 0) return json({ error: "Server configuration incomplete" }, 500);
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "ورود لازم است." }, 401);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  const user = authData.user;
  const email = (user?.email ?? "").toLowerCase();
  if (authError || !user || !email || !allowlist.includes(email) || !user.email_confirmed_at) return json({ error: "این حساب اجازهٔ مدیریت روزنو را ندارد." }, 403);
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }
  const action = body.action;

  async function audit(actionName: string, target: string | null, reason: string, details: Record<string, unknown> = {}) {
    const { error } = await db.from("admin_audit_log").insert({ admin_user_id: user!.id, admin_email: email, action: actionName, target_user_id: target, reason, details });
    if (error) throw new Error("ثبت گزارش مدیریتی ناموفق بود؛ عملیات لغو شد.");
  }
  async function getTarget(id: unknown) {
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("شناسهٔ کاربر معتبر نیست.");
    const { data, error } = await db.auth.admin.getUserById(id);
    if (error || !data.user) throw new Error("کاربر پیدا نشد.");
    return data.user;
  }
  try {
    switch (action) {
      case "whoami": return json({ ok: true, admin: { id: user.id, email } });
      case "list_users": {
        const { data: authUsers, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listError) throw listError;
        const ids = (authUsers.users ?? []).map(u => u.id);
        const { data: profiles, error: profileError } = ids.length ? await db.from("profiles").select("user_id,display_name,lifetime_xp,created_at").in("user_id", ids) : { data: [], error: null };
        if (profileError) throw profileError;
        const pmap = new Map((profiles ?? []).map(p => [p.user_id, p]));
        const result = (authUsers.users ?? []).map(u => { const p = pmap.get(u.id); return { id: u.id, email: u.email ?? null, created_at: u.created_at, banned: !!u.banned_until && new Date(u.banned_until).getTime() > Date.now(), display_name: p?.display_name ?? null, lifetime_xp: p?.lifetime_xp ?? 0 }; });
        await audit("list_users", null, "بازکردن فهرست کاربران", { count: result.length });
        return json({ users: result });
      }
      case "adjust_xp": {
        const target = await getTarget(body.user_id); const reason = body.reason;
        const amount = Number(body.amount);
        if (!reasonValid(reason) || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10000) throw new Error("دلیل یا مقدار XP معتبر نیست.");
        const eventKey = `admin-adjust:${crypto.randomUUID()}`;
        const { error: insertError } = await db.from("xp_events").insert({ user_id: target.id, event_key: eventKey, event_type: "admin_adjustment", amount, metadata: { reason: reason.trim(), admin_user_id: user.id, admin_email: email } });
        if (insertError) throw new Error(insertError.message.includes("check constraint") ? "مهاجرت پنل مدیریت اجرا نشده است. ابتدا migration را با احتیاط اجرا کنید." : "تغییر XP ثبت نشد: " + insertError.message);
        await audit("adjust_xp", target.id, reason.trim(), { amount, event_key: eventKey });
        return json({ ok: true });
      }
      case "warn_user": {
        const target = await getTarget(body.user_id); const reason = body.reason;
        if (!reasonValid(reason)) throw new Error("دلیل هشدار معتبر نیست.");
        const { error } = await db.from("security_alerts").insert({ user_id: target.id, reason: `Admin warning: ${reason.trim()}`, evidence: { source: "admin_panel", admin_user_id: user.id, admin_email: email } });
        if (error) throw error;
        const { error: rerr } = await db.from("admin_user_restrictions").insert({ user_id: target.id, restriction_type: "warning", reason: reason.trim(), created_by: user.id, created_by_email: email });
        if (rerr) throw rerr;
        await audit("warn_user", target.id, reason.trim()); return json({ ok: true });
      }
      case "ban_user": {
        const target = await getTarget(body.user_id); const reason = body.reason;
        if (!reasonValid(reason)) throw new Error("دلیل مسدودسازی معتبر نیست.");
        if (target.id === user.id) throw new Error("مدیر نمی‌تواند حساب خودش را مسدود کند.");
        const { error: banError } = await db.auth.admin.updateUserById(target.id, { ban_duration: "876000h" });
        if (banError) throw banError;
        const { error: rerr } = await db.from("admin_user_restrictions").insert({ user_id: target.id, restriction_type: "account_ban", reason: reason.trim(), created_by: user.id, created_by_email: email });
        if (rerr) throw rerr;
        await audit("ban_user", target.id, reason.trim()); return json({ ok: true });
      }
      case "unban_user": {
        const target = await getTarget(body.user_id); const reason = body.reason;
        if (!reasonValid(reason)) throw new Error("دلیل رفع مسدودی معتبر نیست.");
        const { error } = await db.auth.admin.updateUserById(target.id, { ban_duration: "none" }); if (error) throw error;
        const { error: rerr } = await db.from("admin_user_restrictions").update({ active: false, cleared_at: new Date().toISOString(), cleared_by: user.id, clear_reason: reason.trim() }).eq("user_id", target.id).eq("restriction_type", "account_ban").eq("active", true);
        if (rerr) throw rerr;
        await audit("unban_user", target.id, reason.trim()); return json({ ok: true });
      }
      case "list_alerts": {
        const { data, error } = await db.from("security_alerts").select("id,user_id,reason,evidence,reviewed_at,created_at").order("created_at", { ascending: false }).limit(250);
        if (error) throw error; return json({ alerts: data ?? [] });
      }
      case "review_alert": {
        const alertId = Number(body.alert_id); const reason = body.reason;
        if (!Number.isSafeInteger(alertId) || alertId < 1 || !reasonValid(reason)) throw new Error("شناسه یا نتیجهٔ بررسی معتبر نیست.");
        const { data: alert, error: fetchError } = await db.from("security_alerts").select("id,user_id,reviewed_at").eq("id", alertId).maybeSingle();
        if (fetchError || !alert) throw new Error("هشدار پیدا نشد.");
        const { error } = await db.from("security_alerts").update({ reviewed_at: new Date().toISOString() }).eq("id", alertId); if (error) throw error;
        await audit("review_alert", alert.user_id, reason.trim(), { alert_id: alertId }); return json({ ok: true });
      }
      case "list_audit": {
        const { data, error } = await db.from("admin_audit_log").select("id,admin_user_id,admin_email,action,target_user_id,reason,details,created_at").order("created_at", { ascending: false }).limit(250);
        if (error) throw error; return json({ entries: data ?? [] });
      }
      default: return json({ error: "عملیات ناشناخته است." }, 400);
    }
  } catch (error) {
    console.error("roozno-admin error", error);
    return json({ error: error instanceof Error ? error.message : "خطای داخلی سرور." }, 400);
  }
});
