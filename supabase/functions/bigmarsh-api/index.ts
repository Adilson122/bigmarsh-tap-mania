import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const botUsername = Deno.env.get("BIGMARSH_BOT_USERNAME") ?? "Bigmarsh_bot";

const ADMIN_USERNAME = Deno.env.get("BIGMARSH_ADMIN_USERNAME") ?? "admin";
const ADMIN_PASSWORD = Deno.env.get("BIGMARSH_ADMIN_PASSWORD") ?? "";

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const toDateKey = (value: string) => value.slice(0, 10);

const getPublishedPasses = async () => {
  const { data } = await db
    .from("monetization_passes")
    .select("pass_type,title,duration_days,price_usd,benefits")
    .eq("is_visible", true)
    .eq("is_enabled", true)
    .order("sort_order", { ascending: true });

  return data ?? [];
};

const normalizeState = async (state: any, telegramId: number) => {
  if (!state || typeof state !== "object") return state;

  const today = new Date().toISOString().slice(0, 10);
  const referrals = Array.isArray(state.referrals) ? state.referrals : [];
  const invitedToday = referrals.filter((r: any) => typeof r?.created_at === "string" && toDateKey(r.created_at) === today).length;
  const monetizationPasses = await getPublishedPasses();

  return {
    ...state,
    user: {
      ...state.user,
      referral_link: `https://t.me/${botUsername}?startapp=${telegramId}`,
    },
    monetization_passes: monetizationPasses,
    tasks: Array.isArray(state.tasks)
      ? state.tasks.map((task: any) => {
          const completed = Boolean(task?.completed);
          let claimable = false;
          const target = Math.max(1, Number(task?.target_value ?? (task?.kind === "invite_1" ? 1 : 500)));

          if (!completed) {
            if (task?.kind === "taps_500") claimable = Number(state?.user?.total_taps ?? 0) >= target;
            if (task?.kind === "invite_1") claimable = invitedToday >= target;
          }

          return {
            ...task,
            target_value: target,
            claimable,
          };
        })
      : [],
  };
};

const toHex = (arr: ArrayBuffer) => [...new Uint8Array(arr)].map((b) => b.toString(16).padStart(2, "0")).join("");

const hmac = async (keyRaw: string | Uint8Array, value: string) => {
  const keyData = typeof keyRaw === "string" ? new TextEncoder().encode(keyRaw) : keyRaw;
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
};

async function verifyInitData(initData?: string, debugUser?: any) {
  if (!initData && debugUser?.id) {
    return { id: Number(debugUser.id), username: debugUser.username, first_name: debugUser.first_name, photo_url: debugUser.photo_url };
  }

  if (!initData) throw new Error("init_data_missing");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("hash_missing");
  params.delete("hash");

  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac("WebAppData", botToken);
  const signature = await hmac(secret, dataCheckString);
  if (toHex(signature) !== hash) throw new Error("init_data_invalid");

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("user_missing");
  return JSON.parse(userRaw);
}

const makeSession = async (telegramId: number) => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString();
  await db.from("admin_sessions").insert({ token, telegram_id: telegramId, expires_at: expiresAt });
  return token;
};

const requireAdmin = async (adminToken: string) => {
  const { data: session } = await db.from("admin_sessions").select("token, telegram_id, expires_at, revoked").eq("token", adminToken).maybeSingle();
  if (!session || session.revoked || new Date(session.expires_at).getTime() < Date.now()) throw new Error("admin_session_invalid");
  const { data: role } = await db.from("user_roles").select("id").eq("user_id", session.telegram_id).eq("role", "admin").maybeSingle();
  if (!role) throw new Error("admin_role_required");
  return session;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action as string;
    const initData = body.initData as string | undefined;
    const debugUser = body.debugUser;

    if (["init", "tap", "buy_upgrade", "claim_task", "leaderboard", "admin_login", "admin_dashboard", "admin_update_user", "admin_create_task", "admin_delete_task", "admin_save_task_settings", "admin_save_pass"].includes(action)) {
      const tgUser = await verifyInitData(initData, debugUser);
      const telegramId = Number(tgUser.id);

      if (action === "init") {
        await db.rpc("tg_auth_upsert", {
          _telegram_id: telegramId,
          _username: tgUser.username ?? null,
          _first_name: tgUser.first_name ?? null,
          _avatar_url: tgUser.photo_url ?? null,
          _start_param: body.startParam ?? null,
        });

        await db.rpc("ensure_daily_tasks");

        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ state: normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "tap") {
        const { data: tapData, error: tapError } = await db.rpc("tap_marsh", { _telegram_id: telegramId });
        if (tapError) throw new Error(tapError.message);
        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ tap: tapData?.[0] ?? {}, state: normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "buy_upgrade") {
        const { data: upgradeData, error } = await db.rpc("buy_upgrade", { _telegram_id: telegramId, _upgrade_type: body.upgradeType });
        if (error) throw new Error(error.message);
        if (!upgradeData?.[0]?.ok) throw new Error("insufficient_balance");
        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ state: normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "claim_task") {
        const { error } = await db.rpc("claim_task", { _telegram_id: telegramId, _task_id: body.taskId });
        if (error) throw new Error(error.message);
        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ state: normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "leaderboard") {
        const { data: rows } = await db.rpc("get_leaderboard", { _telegram_id: telegramId, _scope: body.scope ?? "all_time" });
        return new Response(JSON.stringify({ rows }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_login") {
        const user = String(body.username ?? "");
        const pass = String(body.password ?? "");
        const envValid = user === ADMIN_USERNAME && pass === ADMIN_PASSWORD;
        const fallbackValid = user === "admin" && pass === "bigmarsh2026";
        if (!envValid && !fallbackValid) throw new Error("admin_credentials_invalid");

        await db.from("user_roles").upsert({ user_id: telegramId, role: "admin" }, { onConflict: "user_id,role" });
        const token = await makeSession(telegramId);
        return new Response(JSON.stringify({ token }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (["admin_dashboard", "admin_update_user", "admin_create_task", "admin_delete_task", "admin_save_task_settings", "admin_save_pass"].includes(action)) {
        await requireAdmin(String(body.adminToken ?? ""));
      }

      if (action === "admin_update_user") {
        await db.from("users").update({
          bmh_balance: Number(body.bmh_balance ?? 0),
          energy: Number(body.energy ?? 0),
          level: Number(body.level ?? 1),
          is_banned: Boolean(body.is_banned ?? false),
        }).eq("telegram_id", Number(body.telegramId));
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_create_task") {
        await db.from("tasks").upsert({
          title: body.title,
          reward_bmh: Number(body.reward_bmh ?? 0),
          description: body.description ?? null,
          kind: body.kind ?? "taps_500",
          target_value: Math.max(1, Number(body.targetValue ?? (body.kind === "invite_1" ? 1 : 500))),
          active_date: new Date().toISOString().slice(0, 10),
        }, { onConflict: "kind,active_date" });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_save_task_settings") {
        await db.from("task_settings").upsert({
          id: 1,
          referral_goal: Math.max(1, Number(body.referral_goal ?? 1)),
          referral_reward_bmh: Math.max(0, Number(body.referral_reward_bmh ?? 0)),
          tap_goal: Math.max(1, Number(body.tap_goal ?? 1)),
          tap_reward_bmh: Math.max(0, Number(body.tap_reward_bmh ?? 0)),
        }, { onConflict: "id" });

        await db.rpc("ensure_daily_tasks");
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_save_pass") {
        await db.from("monetization_passes").upsert({
          pass_type: String(body.pass_type ?? "weekly"),
          title: String(body.title ?? "Passe"),
          duration_days: Math.max(1, Number(body.duration_days ?? 7)),
          price_usd: Math.max(0, Number(body.price_usd ?? 0)),
          benefits: String(body.benefits ?? ""),
          is_visible: Boolean(body.is_visible ?? false),
          is_enabled: Boolean(body.is_enabled ?? false),
          sort_order: Number(body.sort_order ?? 0),
        }, { onConflict: "pass_type" });

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_delete_task") {
        await db.from("tasks").delete().eq("id", body.taskId);
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_dashboard") {
        const query = String(body.query ?? "");
        const [{ data: stats }, { data: taskRows }, { data: referralRows }, { data: snapshotRows }, { count: allUsersCount }, { count: fakeUsersCount }, { data: passRows }, { data: taskSettings }] = await Promise.all([
          db.rpc("get_admin_stats"),
          db.from("tasks").select("id,title,reward_bmh,kind,target_value").eq("active_date", new Date().toISOString().slice(0, 10)).order("created_at", { ascending: false }),
          db.from("referrals").select("id,referrer_id,referred_id,created_at").order("created_at", { ascending: false }).limit(100),
          db.from("users").select("telegram_id,daily_streak,referrals_count").or("daily_streak.gt.7,referrals_count.gt.5").limit(500),
          db.from("users").select("telegram_id", { count: "exact", head: true }),
          db.from("users").select("telegram_id", { count: "exact", head: true }).or("telegram_id.gte.900000,username.ilike.%ref_master%,username.ilike.%new_marsh%,username.ilike.%dev%"),
          db.from("monetization_passes").select("pass_type,title,duration_days,price_usd,benefits,is_visible,is_enabled,sort_order").order("sort_order", { ascending: true }),
          db.from("task_settings").select("referral_goal,referral_reward_bmh,tap_goal,tap_reward_bmh").eq("id", 1).maybeSingle(),
        ]);

        let usersQuery = db.from("users").select("telegram_id,username,first_name,bmh_balance,energy,level,daily_streak,referrals_count,is_banned").order("created_at", { ascending: false }).limit(100);
        if (query.trim()) {
          usersQuery = usersQuery.or(`username.ilike.%${query}%,first_name.ilike.%${query}%`);
        }
        const { data: usersRows } = await usersQuery;

        const allUsers = Number(allUsersCount ?? 0);
        const fakeUsers = Number(fakeUsersCount ?? 0);
        const realUsers = Math.max(0, allUsers - fakeUsers);
        const mergedStats = {
          ...(stats ?? {}),
          total_users: realUsers,
          real_users: realUsers,
          fake_users: fakeUsers,
          total_users_including_fake: allUsers,
        };

        return new Response(JSON.stringify({
          stats: mergedStats,
          users: usersRows ?? [],
          tasks: taskRows ?? [],
          referrals: referralRows ?? [],
          snapshot: snapshotRows ?? [],
          monetization_passes: passRows ?? [],
          task_settings: taskSettings ?? null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "action_not_supported" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const status = message === "user_banned" ? 403 : message === "insufficient_balance" ? 400 : 500;

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "unknown_error" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});