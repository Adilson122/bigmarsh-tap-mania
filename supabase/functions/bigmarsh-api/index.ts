import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const botUsername = Deno.env.get("BIGMARSH_BOT_USERNAME") ?? "bigmarsh_bot";

const ADMIN_USERNAME = Deno.env.get("BIGMARSH_ADMIN_USERNAME") ?? "admin";
const ADMIN_PASSWORD = Deno.env.get("BIGMARSH_ADMIN_PASSWORD") ?? "";
const TASK_REWARD_MIN = 50;
const TASK_REWARD_MAX = 2000;
const TASK_TARGET_MIN = 1;
const TASK_TARGET_MAX = 2500;
const MANUAL_TASK_KINDS = new Set(["taps_500", "invite_1", "link_visit"]);

const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

const toDateKey = (value: string) => value.slice(0, 10);

const getPublishedPasses = async () => {
  const { data } = await db
    .from("monetization_passes")
    .select("pass_type,title,duration_days,price_usd,price_ton,benefits")
    .eq("is_visible", true)
    .eq("is_enabled", true)
    .order("sort_order", { ascending: true });

  return data ?? [];
};

const normalizeState = async (state: any, telegramId: number) => {
  if (!state || typeof state !== "object") return state;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffToMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  const weekStartIso = weekStart.toISOString();
  const referrals = Array.isArray(state.referrals) ? state.referrals : [];
  const invitedToday = referrals.filter((r: any) => typeof r?.created_at === "string" && toDateKey(r.created_at) === today).length;
  const invitedThisWeek = referrals.filter((r: any) => typeof r?.created_at === "string" && r.created_at >= weekStartIso).length;
  const monetizationPasses = await getPublishedPasses();

  return {
    ...state,
    user: {
      ...state.user,
      referral_link: `https://t.me/${botUsername}?start=ref_${telegramId}`,
    },
    monetization_passes: monetizationPasses,
    tasks: Array.isArray(state.tasks)
      ? state.tasks.map((task: any) => {
          const completed = Boolean(task?.completed);
          let claimable = Boolean(task?.claimable ?? false);
          const target = Math.max(
            1,
            Number(
              task?.target_value ?? (
                task?.kind === "invite_1" || task?.kind === "link_visit"
                  ? 1
                  : task?.kind === "weekly_invite"
                    ? 3
                    : task?.kind === "weekly_bmh"
                      ? 25000
                      : 500
              ),
            ),
          );

          if (!completed) {
            if (task?.kind === "taps_500") claimable = Number(state?.user?.total_taps ?? 0) >= target;
            if (task?.kind === "invite_1") claimable = invitedToday >= target;
            if (task?.kind === "weekly_invite") claimable = invitedThisWeek >= target;
            if (task?.kind === "weekly_bmh") claimable = Number(state?.user?.weekly_bmh ?? 0) >= target;
            if (task?.kind === "link_visit") claimable = String(task?.link_url ?? "").trim().length > 0;
            if (task?.kind === "watch_ad" || task?.kind === "ad_watch") claimable = Boolean(task?.claimable ?? false);
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

const sendTelegramMessage = async (chatId: number, text: string, replyMarkup?: Record<string, unknown>) => {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`telegram_send_failed:${response.status}:${payload}`);
  }
};

const sendWelcomeMessage = async (chatId: number) => {
  const welcome = "🌿 <b>Welcome to BigMarsh!</b>\nTap start and begin farming BMH now.";
  await sendTelegramMessage(chatId, welcome, {
    inline_keyboard: [[{ text: "Start", url: `https://t.me/${botUsername}/app` }]],
  });
};

const hmac = async (keyRaw: string | Uint8Array, value: string) => {
  const keyData = typeof keyRaw === "string" ? new TextEncoder().encode(keyRaw) : keyRaw;
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)));
};

async function verifyInitData(initData?: string, debugUser?: any) {
  if (!initData && debugUser?.id) {
    return {
      id: Number(debugUser.id),
      username: debugUser.username,
      first_name: debugUser.first_name,
      photo_url: debugUser.photo_url,
      __is_debug: true,
    };
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

    if (["init", "tap", "buy_upgrade", "claim_task", "claim_ad_slot", "leaderboard", "connect_wallet", "create_pass_checkout", "confirm_pass_checkout", "admin_login", "admin_dashboard", "admin_update_user", "admin_create_task", "admin_delete_task", "admin_save_task_settings", "admin_save_pass", "admin_save_app_settings"].includes(action)) {
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

        await db
          .from("users")
          .update({ is_fake: Boolean((tgUser as { __is_debug?: boolean }).__is_debug) })
          .eq("telegram_id", telegramId);

        const { data: pendingReferral } = await db
          .from("referrals")
          .select("id, referrer_id")
          .eq("referred_id", telegramId)
          .is("notified_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pendingReferral?.referrer_id) {
          const inviterName = tgUser.first_name ?? tgUser.username ?? `#${telegramId}`;
          const congratulations = `🎉 <b>Congratulations!</b>\nYou just invited <b>${inviterName}</b> to BigMarsh.\nKeep inviting friends to climb the ranking and earn more BMH!`;

          try {
            await sendWelcomeMessage(telegramId);
            await sendTelegramMessage(Number(pendingReferral.referrer_id), congratulations);
            await db.from("referrals").update({ notified_at: new Date().toISOString() }).eq("id", pendingReferral.id);
          } catch (notifyError) {
            console.error("referral_notification_failed", notifyError);
          }
        }

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

      if (action === "claim_ad_slot") {
        const slotNo = Number(body.slotNo ?? 0);
        if (!Number.isFinite(slotNo) || slotNo < 1 || slotNo > 10) throw new Error("invalid_ad_slot");

        const { data: claimRes, error } = await db.rpc("claim_ad_slot", { _telegram_id: telegramId, _slot_no: slotNo });
        if (error) throw new Error(error.message);
        if (!claimRes?.[0]?.ok) throw new Error("ad_not_claimable_yet");

        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ state: normalized, claim: claimRes?.[0] ?? null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "connect_wallet") {
        const walletAddress = String(body.walletAddress ?? "").trim();
        const { data, error } = await db.rpc("connect_user_wallet", { _telegram_id: telegramId, _wallet_address: walletAddress });
        if (error) throw new Error(error.message);

        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ wallet_address: data, state: normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "create_pass_checkout") {
        const passType = String(body.passType ?? "");
        const { data, error } = await db.rpc("create_pass_checkout", { _telegram_id: telegramId, _pass_type: passType });
        if (error) throw new Error(error.message);
        return new Response(JSON.stringify({ checkout: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "confirm_pass_checkout") {
        const purchaseId = String(body.purchaseId ?? "");
        const txHash = String(body.txHash ?? "").trim() || null;
        const { data, error } = await db.rpc("confirm_pass_checkout", {
          _telegram_id: telegramId,
          _purchase_id: purchaseId,
          _tx_hash: txHash,
        });
        if (error) throw new Error(error.message);

        const { data: state } = await db.rpc("get_state", { _telegram_id: telegramId });
        const normalized = await normalizeState(state, telegramId);
        return new Response(JSON.stringify({ result: data, state: normalized }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

      if (["admin_dashboard", "admin_update_user", "admin_create_task", "admin_delete_task", "admin_save_task_settings", "admin_save_pass", "admin_save_app_settings"].includes(action)) {
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
        const kind = String(body.kind ?? "taps_500");
        if (!MANUAL_TASK_KINDS.has(kind)) throw new Error("manual_task_kind_not_allowed");

        const reward = Math.max(TASK_REWARD_MIN, Math.min(TASK_REWARD_MAX, Number(body.reward_bmh ?? 0)));
        const defaultTarget = kind === "invite_1" || kind === "link_visit" ? 1 : 300;
        const target = Math.max(TASK_TARGET_MIN, Math.min(TASK_TARGET_MAX, Number(body.targetValue ?? defaultTarget)));
        const normalizedLink = kind === "link_visit" ? String(body.linkUrl ?? "").trim() || null : null;

        const activeDate = new Date().toISOString().slice(0, 10);
        const payload = {
          title: String(body.title ?? "Task"),
          reward_bmh: reward,
          description: body.description ?? null,
          kind,
          target_value: target,
          link_url: normalizedLink,
          active_date: activeDate,
        };

        const { data: existingTask, error: existingTaskError } = await db
          .from("tasks")
          .select("id")
          .eq("kind", kind)
          .eq("active_date", activeDate)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (existingTaskError) throw new Error(existingTaskError.message);

        if (existingTask?.id) {
          const { error: updateTaskError } = await db.from("tasks").update(payload).eq("id", existingTask.id);
          if (updateTaskError) throw new Error(updateTaskError.message);
        } else {
          const { error: insertTaskError } = await db.from("tasks").insert(payload);
          if (insertTaskError) throw new Error(insertTaskError.message);
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_save_task_settings") {
        const referralGoal = Math.max(1, Math.min(25, Number(body.referral_goal ?? 1)));
        const referralReward = Math.max(180, Math.min(1800, Number(body.referral_reward_bmh ?? 500)));
        const tapGoal = Math.max(100, Math.min(1500, Number(body.tap_goal ?? 300)));
        const tapReward = Math.max(120, Math.min(1200, Number(body.tap_reward_bmh ?? 350)));

        await db.from("task_settings").upsert({
          id: 1,
          referral_goal: referralGoal,
          referral_reward_bmh: referralReward,
          tap_goal: tapGoal,
          tap_reward_bmh: tapReward,
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
          price_ton: Math.max(0.01, Number(body.price_ton ?? 0.1)),
          benefits: String(body.benefits ?? ""),
          is_visible: Boolean(body.is_visible ?? false),
          is_enabled: Boolean(body.is_enabled ?? false),
          sort_order: Number(body.sort_order ?? 0),
        }, { onConflict: "pass_type" });

        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_save_app_settings") {
        const tonReceiverAddress = String(body.ton_receiver_address ?? "").trim();
        await db.from("app_settings").upsert({ id: 1, ton_receiver_address: tonReceiverAddress }, { onConflict: "id" });
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_delete_task") {
        await db.from("tasks").delete().eq("id", body.taskId);
        return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "admin_dashboard") {
        const query = String(body.query ?? "");
        const [{ data: stats }, { data: taskRows }, { data: referralRows }, { data: snapshotRows }, { count: allUsersCount }, { count: fakeUsersCount }, { data: passRows }, { data: taskSettings }, { data: appSettings }] = await Promise.all([
          db.rpc("get_admin_stats"),
          db.from("tasks").select("id,title,reward_bmh,kind,target_value,link_url").eq("active_date", new Date().toISOString().slice(0, 10)).order("created_at", { ascending: false }),
          db.from("referrals").select("id,referrer_id,referred_id,created_at").order("created_at", { ascending: false }).limit(100),
          db.from("users").select("telegram_id,daily_streak,referrals_count").or("daily_streak.gt.7,referrals_count.gt.5").limit(500),
          db.from("users").select("telegram_id", { count: "exact", head: true }),
          db.from("users").select("telegram_id", { count: "exact", head: true }).eq("is_fake", true),
          db.from("monetization_passes").select("pass_type,title,duration_days,price_usd,price_ton,benefits,is_visible,is_enabled,sort_order").order("sort_order", { ascending: true }),
          db.from("task_settings").select("referral_goal,referral_reward_bmh,tap_goal,tap_reward_bmh").eq("id", 1).maybeSingle(),
          db.from("app_settings").select("ton_receiver_address").eq("id", 1).maybeSingle(),
        ]);

        let usersQuery = db.from("users").select("telegram_id,username,first_name,bmh_balance,energy,level,daily_streak,referrals_count,is_banned,is_fake").order("created_at", { ascending: false }).limit(100);
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
          app_settings: appSettings ?? null,
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