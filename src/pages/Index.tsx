import { useEffect, useMemo, useState } from "react";
import { Trophy, Zap, Users, ListChecks, ArrowUpCircle, Sparkles, Wallet } from "lucide-react";
import { callBigMarsh, type GameState } from "@/lib/bigmarsh-api";
import { getStartParam, getTelegramApp, getTelegramUser, setupTelegram } from "@/lib/telegram";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type LeaderboardRow = {
  rank_no: number;
  telegram_id: number;
  username?: string;
  first_name?: string;
  avatar_url?: string;
  bmh_balance: number;
  weekly_bmh: number;
};

type TabKey = "tap" | "upgrades" | "referrals" | "leaderboard" | "tasks" | "passes";

type PassCheckout = {
  purchase_id: string;
  amount_nano: number;
  amount_ton: number;
  recipient_address: string;
  payment_comment: string;
  expires_at: string;
};

const tabs: Array<{ key: TabKey; label: string; icon: typeof Zap }> = [
  { key: "tap", label: "Tap", icon: Zap },
  { key: "upgrades", label: "Upgrades", icon: ArrowUpCircle },
  { key: "passes", label: "Passes", icon: Sparkles },
  { key: "referrals", label: "Referrals", icon: Users },
  { key: "leaderboard", label: "Leaderboard", icon: Trophy },
  { key: "tasks", label: "Tasks", icon: ListChecks },
];

const BOOT_TIMEOUT_MS = 8000;

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const isAdTask = (task: GameState["tasks"][number]) => {
  const kind = String(task.kind ?? "").toLowerCase();
  return kind === "watch_ad" || kind === "ad_watch";
};

type MonetagShow = () => Promise<unknown>;

type Locale = "en" | "pt" | "es";

const MONETAG_SCRIPT_ID = "bigmarsh-monetag-sdk";
const MONETAG_SCRIPT_SRC = "https://libtl.com/sdk.js";

const loadMonetagSdk = async (): Promise<MonetagShow | null> => {
  const win = window as Window & { show_10755955?: MonetagShow };
  if (typeof win.show_10755955 === "function") {
    return win.show_10755955;
  }

  const existingScript = document.getElementById(MONETAG_SCRIPT_ID) as HTMLScriptElement | null;
  if (!existingScript) {
    const script = document.createElement("script");
    script.id = MONETAG_SCRIPT_ID;
    script.src = MONETAG_SCRIPT_SRC;
    script.dataset.zone = "10755955";
    script.dataset.sdk = "show_10755955";
    script.async = true;
    document.head.appendChild(script);
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("ads_load_timeout")), 7000);
    const poll = window.setInterval(() => {
      if (typeof win.show_10755955 === "function") {
        window.clearInterval(poll);
        window.clearTimeout(timeoutId);
        resolve();
      }
    }, 120);
  }).catch(() => undefined);

  return typeof win.show_10755955 === "function" ? win.show_10755955 : null;
};

const upgradeMeta: Record<GameState["upgrades"][number]["upgrade_type"], { title: string; description: string }> = {
  marsh_factory: { title: "Marsh Factory", description: "Aumenta o ganho base por tap." },
  viral_boost: { title: "Viral Boost", description: "Aumenta levemente o multiplicador de combo." },
  referral_multiplier: { title: "Referral Multiplier", description: "Melhora o bônus recebido por indicação ativa." },
  energy_core: { title: "Energy Core", description: "Eleva o limite de energia máxima para jogar mais tempo." },
  precision_tap: { title: "Precision Tap", description: "Aumenta precisão do tap e ganho total por ação." },
};

const messages: Record<Locale, Record<string, string>> = {
  en: {
    connecting: "Connecting BigMarsh...",
    syncing: "Syncing your Telegram account.",
    timeout: "Connection timed out.",
    retry: "Try again",
    blockedTitle: "Your account is temporarily blocked",
    blockedSubtitle: "No worries: your progress is safe. Contact support/admin for review.",
    accountStatus: "Account status",
    blocked: "Blocked",
    level: "Level",
    energy: "Energy",
    connectWallet: "Connect Wallet",
    walletHint: "Link your TON address to buy passes and join airdrops.",
    walletPlaceholder: "Paste your TON address",
    updateWallet: "Update wallet",
    linkedWallet: "Connected",
    copyLink: "Copy link",
    share: "Share",
    referredFriends: "Referred friends",
    noReferredFriends: "No invited friends yet.",
    goToWallet: "Go connect wallet",
    dailyStreak: "Daily streak",
    days: "days",
    totalTaps: "Total taps",
    excitingShare: "🚀 I just started farming BMH on BigMarsh! Fast taps, ad boosts, weekly missions and TON passes. Join me now and claim your starter bonus!",
  },
  pt: {
    connecting: "Conectando BigMarsh...",
    syncing: "Sincronizando sua conta no Telegram.",
    timeout: "A conexão expirou.",
    retry: "Tentar novamente",
    blockedTitle: "Sua conta está temporariamente bloqueada",
    blockedSubtitle: "Não se preocupe: seus dados foram preservados. Entre em contato com o suporte/admin para revisão.",
    accountStatus: "Status da conta",
    blocked: "Bloqueada",
    level: "Nível",
    energy: "Energia",
    connectWallet: "Conectar Wallet",
    walletHint: "Vincule seu endereço TON para comprar passes e participar do airdrop.",
    walletPlaceholder: "Cole seu endereço TON",
    updateWallet: "Atualizar carteira",
    linkedWallet: "Conectada",
    copyLink: "Copiar link",
    share: "Compartilhar",
    referredFriends: "Amigos indicados",
    noReferredFriends: "Nenhum convidado ainda.",
    goToWallet: "Ir para conectar carteira",
    dailyStreak: "Streak diário",
    days: "dias",
    totalTaps: "Taps totais",
    excitingShare: "🚀 Entrei no BigMarsh e já estou farmando BMH! Tap rápido, boost por anúncios, missões semanais e passes TON. Entra comigo agora e pega seu bônus inicial!",
  },
  es: {
    connecting: "Conectando BigMarsh...",
    syncing: "Sincronizando tu cuenta de Telegram.",
    timeout: "La conexión expiró.",
    retry: "Reintentar",
    blockedTitle: "Tu cuenta está bloqueada temporalmente",
    blockedSubtitle: "Tranquilo: tu progreso está guardado. Contacta al soporte/admin para revisión.",
    accountStatus: "Estado de la cuenta",
    blocked: "Bloqueada",
    level: "Nivel",
    energy: "Energía",
    connectWallet: "Conectar Wallet",
    walletHint: "Vincula tu dirección TON para comprar pases y entrar al airdrop.",
    walletPlaceholder: "Pega tu dirección TON",
    updateWallet: "Actualizar billetera",
    linkedWallet: "Conectada",
    copyLink: "Copiar enlace",
    share: "Compartir",
    referredFriends: "Amigos referidos",
    noReferredFriends: "Aún no hay amigos invitados.",
    goToWallet: "Ir a conectar billetera",
    dailyStreak: "Racha diaria",
    days: "días",
    totalTaps: "Taps totales",
    excitingShare: "🚀 ¡Ya empecé a farmear BMH en BigMarsh! Taps rápidos, boosts de anuncios, misiones semanales y pases TON. ¡Únete ahora y reclama tu bono inicial!",
  },
};

const Index = () => {
  const [state, setState] = useState<GameState | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [apiStatus, setApiStatus] = useState<"online" | "degraded" | "offline">("online");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("tap");
  const [lbScope, setLbScope] = useState<"all_time" | "weekly" | "friends">("all_time");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [tapFx, setTapFx] = useState<Array<{ id: number; value: number; x: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"tap" | "upgrade" | "task" | "referral_copy" | "referral_share" | "wallet" | "pass_checkout" | "pass_confirm" | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [accountBlocked, setAccountBlocked] = useState(false);
  const [walletInput, setWalletInput] = useState("");
  const [passCheckout, setPassCheckout] = useState<PassCheckout | null>(null);
  const [txHashInput, setTxHashInput] = useState("");
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem("bigmarsh_locale");
    return saved === "pt" || saved === "es" || saved === "en" ? saved : "en";
  });

  const telegramUser = useMemo(() => getTelegramUser(), []);
  const initData = getTelegramApp()?.initData ?? "";
  const copy = messages[locale];
  const numberLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";

  useEffect(() => {
    localStorage.setItem("bigmarsh_locale", locale);
  }, [locale]);

  const bootstrap = async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestStartedAt = Date.now();

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsBootstrapping(true);
      setTimedOut(false);
      setError(null);
    }

    try {
      const data = await withTimeout(
        callBigMarsh<{ state: GameState }>("init", {
          initData,
          startParam: getStartParam(),
          debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
        }),
        BOOT_TIMEOUT_MS,
      );

      const latency = Date.now() - requestStartedAt;
      setState(data.state);
      setAccountBlocked(false);
      setApiStatus(latency > 3000 ? "degraded" : "online");
      setLastSyncAt(new Date());
      setLastLatencyMs(latency);
      setError(null);
      setTimedOut(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao iniciar o app";

      if (msg === "user_banned") {
        setAccountBlocked(true);
        setError(null);
        setTimedOut(false);
        return;
      }

      setApiStatus("offline");

      if (msg === "timeout") {
        setTimedOut(true);
        setError("Conexão demorou demais.");
      } else {
        setError("Falha ao conectar com BigMarsh.");
      }
    } finally {
      if (silent) {
        setIsRefreshing(false);
      } else {
        setIsBootstrapping(false);
      }
    }
  };

  const loadLeaderboard = async (scope = lbScope) => {
    try {
      const data = await callBigMarsh<{ rows: LeaderboardRow[] }>("leaderboard", {
        initData,
        scope,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      setLeaderboard(data.rows);
    } catch {
      setLeaderboard([]);
    }
  };

  useEffect(() => {
    setupTelegram();
    bootstrap({ silent: false });
  }, []);

  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      if (busyAction) return;
      bootstrap({ silent: true });
    }, 3000);
    return () => clearInterval(timer);
  }, [state?.user.telegram_id, busyAction]);

  useEffect(() => {
    if (activeTab === "leaderboard") loadLeaderboard();
  }, [activeTab, lbScope]);

  useEffect(() => {
    if (!state?.user.wallet_address) return;
    setWalletInput(state.user.wallet_address);
  }, [state?.user.wallet_address]);

  const onTap = async () => {
    if (!state || state.user.energy <= 0) return;
    const fxId = Date.now();
    try {
      setBusyAction("tap");
      setActionError(null);
      const data = await callBigMarsh<{ tap: { earned_bmh: number }; state: GameState }>("tap", {
        initData,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      setState(data.state);
      setTapFx((prev) => [...prev, { id: fxId, value: data.tap.earned_bmh, x: Math.floor(Math.random() * 120 - 60) }]);
      getTelegramApp()?.HapticFeedback?.impactOccurred("light");
      setTimeout(() => setTapFx((prev) => prev.filter((f) => f.id !== fxId)), 900);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível tapar agora.";
      if (msg === "user_banned") {
        setAccountBlocked(true);
        setActionError(null);
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const buyUpgrade = async (upgradeType: string) => {
    try {
      setBusyAction("upgrade");
      setActionError(null);
      await callBigMarsh("buy_upgrade", {
        initData,
        upgradeType,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      await bootstrap({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao comprar upgrade.";
      if (msg === "user_banned") {
        setAccountBlocked(true);
        setActionError(null);
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const claimTask = async (taskId: string) => {
    try {
      setBusyAction("task");
      setActionError(null);
      await callBigMarsh("claim_task", {
        initData,
        taskId,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      await bootstrap({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao coletar task.";
      if (msg === "user_banned") {
        setAccountBlocked(true);
        setActionError(null);
      } else if (msg === "insufficient_balance") {
        setActionError("Saldo insuficiente.");
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const copyReferralLink = async () => {
    if (!state) return;
    try {
      setBusyAction("referral_copy");
      setActionError(null);
      await navigator.clipboard.writeText(state.user.referral_link);
    } catch {
      setActionError("Não foi possível copiar o link agora.");
    } finally {
      setBusyAction(null);
    }
  };

  const shareReferralLink = async () => {
    if (!state) return;
    try {
      setBusyAction("referral_share");
      setActionError(null);
      if (navigator.share) {
        await navigator.share({
          title: "BigMarsh",
          text: copy.excitingShare,
          url: state.user.referral_link,
        });
      } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(state.user.referral_link)}&text=${encodeURIComponent(copy.excitingShare)}`, "_blank", "noopener,noreferrer");
      }
    } catch {
      setActionError("Não foi possível compartilhar agora.");
    } finally {
      setBusyAction(null);
    }
  };

  const claimAdSlot = async (slotNo: number) => {
    try {
      setBusyAction("task");
      setActionError(null);
      await callBigMarsh("claim_ad_slot", {
        initData,
        slotNo,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      await bootstrap({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao coletar anúncio.";
      if (msg === "user_banned") {
        setAccountBlocked(true);
        setActionError(null);
      } else if (msg === "ad_not_claimable_yet") {
        setActionError("Esse anúncio acabou de ser usado. Aguarde o próximo ciclo automático.");
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const connectWallet = async () => {
    const address = walletInput.trim();
    if (!address) {
      setActionError("Informe o endereço da sua carteira TON.");
      return;
    }

    try {
      setBusyAction("wallet");
      setActionError(null);
      await callBigMarsh("connect_wallet", {
        initData,
        walletAddress: address,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      await bootstrap({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível conectar a carteira.";
      if (msg === "wallet_address_invalid") {
        setActionError("Endereço de carteira inválido.");
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const createPassCheckout = async (passType: "weekly" | "monthly") => {
    try {
      setBusyAction("pass_checkout");
      setActionError(null);
      const data = await callBigMarsh<{ checkout: PassCheckout }>("create_pass_checkout", {
        initData,
        passType,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });

      setPassCheckout(data.checkout);
      setTxHashInput("");

      const paymentUrl = `ton://transfer/${encodeURIComponent(data.checkout.recipient_address)}?amount=${data.checkout.amount_nano}&text=${encodeURIComponent(data.checkout.payment_comment)}`;
      const tg = getTelegramApp();
      if (tg?.openLink) {
        tg.openLink(paymentUrl, { try_instant_view: false });
      } else {
        window.open(paymentUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao iniciar checkout.";
      if (msg === "wallet_not_connected") {
        setActionError("Conecte sua carteira antes de comprar um passe.");
      } else if (msg === "checkout_receiver_not_configured") {
        setActionError("Checkout TON ainda não configurado no painel admin.");
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const confirmPassCheckout = async () => {
    if (!passCheckout) return;
    try {
      setBusyAction("pass_confirm");
      setActionError(null);
      await callBigMarsh("confirm_pass_checkout", {
        initData,
        purchaseId: passCheckout.purchase_id,
        txHash: txHashInput.trim() || null,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      setPassCheckout(null);
      setTxHashInput("");
      await bootstrap({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha ao confirmar compra.";
      if (msg === "purchase_expired") {
        setActionError("Checkout expirou. Inicie a compra novamente.");
        setPassCheckout(null);
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleTaskAction = async (task: GameState["tasks"][number]) => {
    if (task.completed) return;

    if (isAdTask(task)) {
      if (!task.claimable) {
        setActionError("Esse anúncio está em recarga. Tente em instantes.");
        return;
      }

      const monetagSdk = await loadMonetagSdk();
      if (!monetagSdk) {
        setActionError("Anúncio indisponível no momento.");
        return;
      }

      if (!getTelegramApp()) {
        setActionError("Essas tarefas de anúncio só funcionam dentro do Telegram.");
        return;
      }

      try {
        setBusyAction("task");
        setActionError(null);

        await monetagSdk();
        if (String(task.id).startsWith("ad_slot_")) {
          const slotNo = Number(String(task.id).replace("ad_slot_", ""));
          if (Number.isFinite(slotNo) && slotNo >= 1 && slotNo <= 10) {
            await claimAdSlot(slotNo);
          } else {
            setActionError("Slot de anúncio inválido.");
          }
        } else {
          await claimTask(task.id);
        }
      } catch {
        setActionError("Não foi possível carregar o anúncio agora.");
      } finally {
        setBusyAction(null);
      }

      return;
    }

    if (task.claimable) {
      await claimTask(task.id);
      return;
    }

    if (task.kind === "link_visit") {
      const rawUrl = String(task.link_url ?? "").trim();
      if (!rawUrl) {
        setActionError("Link da tarefa não configurado.");
        return;
      }

      const taskUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      window.open(taskUrl, "_blank", "noopener,noreferrer");
      await claimTask(task.id);
      return;
    }

    if (task.kind === "invite_1" || task.kind === "weekly_invite") {
      setActiveTab("referrals");
      return;
    }

    setActiveTab("tap");
  };

  if (isBootstrapping && !state) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card/85 p-5 text-center">
          <p className="text-base font-medium text-foreground">{copy.connecting}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {timedOut ? copy.timeout : copy.syncing}
          </p>
          {(timedOut || error) && (
            <Button className="mt-4 w-full" onClick={() => bootstrap({ silent: false })}>
              {copy.retry}
            </Button>
          )}
        </div>
      </main>
    );
  }

  if (!state || error) {
    return <main className="flex min-h-screen items-center justify-center text-destructive">{error ?? "Falha ao carregar"}</main>;
  }

  if (accountBlocked) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <Card className="w-full border-border/70 bg-card/85 p-5">
          <div className="mb-4 rounded-xl bg-secondary/60 px-3 py-2 text-xs">
             <span className="text-muted-foreground">{copy.accountStatus}: </span>
             <span className="font-semibold text-destructive">{copy.blocked}</span>
          </div>
          <h1 className="text-lg font-semibold">{copy.blockedTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.blockedSubtitle}</p>
          <Button className="mt-4 w-full" onClick={() => bootstrap({ silent: false })}>
            {copy.retry}
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-28 pt-4">
      <header className="mb-4 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-glow">
        <h1 className="text-2xl font-bold">BigMarsh - Tap to BMH</h1>
        <p className="text-sm text-muted-foreground">{state.airdrop_placeholder}</p>
        <div className="mt-2 flex items-center gap-2">
          {(["en", "pt", "es"] as const).map((lang) => (
            <Button
              key={lang}
              type="button"
              size="sm"
              variant={locale === lang ? "default" : "secondary"}
              onClick={() => setLocale(lang)}
              className="h-7 px-2 text-xs uppercase"
            >
              {lang}
            </Button>
          ))}
        </div>
        {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>{copy.level} {state.user.level}</span>
          <span className="font-semibold text-primary">{state.user.bmh_balance.toLocaleString(numberLocale)} BMH</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(state.user.energy / state.user.max_energy) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{copy.energy} {state.user.energy}/{state.user.max_energy} · +1 in {state.user.next_regen_in}s</p>
      </header>

      {activeTab === "tap" && (
        <section className="space-y-4">
          <Card className="relative overflow-hidden border-border/70 bg-card/85 p-6 text-center">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Combo ativo e haptics Telegram</p>
            <button onClick={onTap} className="relative mx-auto flex h-52 w-52 items-center justify-center rounded-full border border-primary/70 bg-secondary text-8xl shadow-glow transition-transform active:scale-95" aria-label="Tap no Marsh">
              🦊
              <span className="pointer-events-none absolute inset-0 rounded-full border border-primary/60 animate-pulseTap" />
            </button>
            {tapFx.map((f) => (
              <span key={f.id} className="pointer-events-none absolute left-1/2 top-20 animate-rise text-lg font-bold text-primary" style={{ transform: `translateX(${f.x}px)` }}>
                +{f.value} BMH
              </span>
            ))}
          </Card>
          <Card className="border-border/70 bg-card/85 p-4 text-sm">
            <p>{copy.dailyStreak}: <span className="font-semibold text-primary">{state.user.daily_streak} {copy.days}</span></p>
            <p>{copy.totalTaps}: {state.user.total_taps.toLocaleString(numberLocale)}</p>
          </Card>
        </section>
      )}

      {activeTab === "upgrades" && (
        <section className="space-y-3">
          {state.upgrades.map((u) => (
            <Card key={u.upgrade_type} className="border-border/70 bg-card/85 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">{upgradeMeta[u.upgrade_type]?.title ?? u.upgrade_type.replace("_", " ")}</h2>
                <span className="text-sm text-primary">Lv {u.level}</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">{upgradeMeta[u.upgrade_type]?.description ?? "Upgrade de progressão."}</p>
              <Button className="w-full" disabled={busyAction !== null} onClick={() => buyUpgrade(u.upgrade_type)}>
                Comprar ({u.next_cost.toLocaleString("pt-BR")} BMH)
              </Button>
            </Card>
          ))}
        </section>
      )}

      {activeTab === "passes" && (
        <section className="space-y-3">
          <Card className="border-border/70 bg-card/85 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Conectar Wallet</h2>
                <p className="text-xs text-muted-foreground">{copy.walletHint}</p>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <input
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
              className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder={copy.walletPlaceholder}
            />
            <Button className="w-full" variant="outline" disabled={busyAction !== null} onClick={() => void connectWallet()}>
              {state.user.wallet_address ? copy.updateWallet : copy.connectWallet}
            </Button>
            {state.user.wallet_address && <p className="mt-2 break-all text-xs text-muted-foreground">{copy.linkedWallet}: {state.user.wallet_address}</p>}
          </Card>
          {(state.active_passes ?? []).length > 0 && (
            <Card className="border-border/70 bg-card/85 p-4">
              <p className="mb-2 font-semibold">Passes ativos</p>
              <div className="space-y-1 text-xs">
                {(state.active_passes ?? []).map((p) => (
                  <p key={`${p.pass_type}-${p.expires_at}`}>
                    {p.pass_type === "weekly" ? "Semanal" : "Mensal"} ativo até {new Date(p.expires_at).toLocaleString("pt-BR")}
                  </p>
                ))}
              </div>
            </Card>
          )}
          {(state.monetization_passes ?? []).map((pass) => (
            <Card key={pass.pass_type} className="border-border/70 bg-card/85 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">{pass.title}</h2>
                <span className="text-sm text-primary">{Number(pass.price_ton ?? 0).toFixed(3)} TON</span>
              </div>
              <p className="text-sm text-muted-foreground">Duração: {pass.duration_days} dia(s)</p>
              <p className="mt-1 text-sm text-muted-foreground">{pass.benefits}</p>
              <Button className="mt-3 w-full" disabled={busyAction !== null} onClick={() => void createPassCheckout(pass.pass_type)}>
                Comprar agora
              </Button>
            </Card>
          ))}
          {passCheckout && (
            <Card className="border-border/70 bg-card/85 p-4">
              <p className="font-semibold">Checkout iniciado</p>
              <p className="mt-1 text-xs text-muted-foreground">Comentário da transferência: {passCheckout.payment_comment}</p>
              <input
                value={txHashInput}
                onChange={(e) => setTxHashInput(e.target.value)}
                className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="Hash da transação (opcional)"
              />
              <Button className="mt-2 w-full" disabled={busyAction !== null} onClick={() => void confirmPassCheckout()}>
                Confirmar pagamento
              </Button>
            </Card>
          )}
          {(state.monetization_passes ?? []).length === 0 && (
            <Card className="border-border/70 bg-card/85 p-4 text-sm text-muted-foreground">
              Nenhum passe disponível no momento.
            </Card>
          )}
        </section>
      )}

      {activeTab === "referrals" && (
        <section className="space-y-3">
          <Card className="border-border/70 bg-card/85 p-4">
            <p className="text-sm text-muted-foreground">Link único</p>
            <p className="mt-1 break-all text-sm">{state.user.referral_link}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busyAction !== null} onClick={copyReferralLink}>{copy.copyLink}</Button>
              <Button disabled={busyAction !== null} onClick={shareReferralLink}>{copy.share}</Button>
            </div>
            <Button className="mt-2 w-full" variant="outline" disabled={busyAction !== null} onClick={() => setActiveTab("passes")}>
              {copy.goToWallet}
            </Button>
          </Card>
          <Card className="border-border/70 bg-card/85 p-4">
            <p className="mb-2 font-semibold">{copy.referredFriends} ({state.referrals.length})</p>
            <div className="space-y-2 text-sm">
              {state.referrals.map((r) => (
                <div key={r.telegram_id} className="flex items-center justify-between rounded-lg bg-secondary/70 px-3 py-2">
                  <span>{r.first_name ?? r.username ?? `#${r.telegram_id}`}</span>
                  <span className="text-primary">+5% eterno</span>
                </div>
              ))}
              {state.referrals.length === 0 && <p className="text-muted-foreground">{copy.noReferredFriends}</p>}
            </div>
          </Card>
        </section>
      )}

      {activeTab === "leaderboard" && (
        <section className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {([
              ["all_time", "All-Time"],
              ["weekly", "Weekly"],
              ["friends", "Friends"],
            ] as const).map(([key, label]) => (
              <Button key={key} variant={lbScope === key ? "default" : "secondary"} onClick={() => setLbScope(key)}>
                {label}
              </Button>
            ))}
          </div>
          <Card className="border-border/70 bg-card/85 p-3">
            <div className="space-y-2">
              {leaderboard.map((row) => (
                <div key={row.telegram_id} className="flex items-center justify-between rounded-lg bg-secondary/70 px-3 py-2 text-sm">
                  <span>#{row.rank_no} {row.first_name ?? row.username ?? row.telegram_id}</span>
                   <span className="font-semibold text-primary">{(lbScope === "weekly" ? row.weekly_bmh : row.bmh_balance).toLocaleString(numberLocale)} BMH</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {activeTab === "tasks" && (
        <section className="space-y-3">
          {state.tasks.map((task) => (
            <Card key={task.id} className="border-border/70 bg-card/85 p-4">
              <h2 className="font-semibold">{task.title}</h2>
              <p className="text-sm text-muted-foreground">{task.description}</p>
              {task.kind === "link_visit" && task.link_url && (
                <p className="mt-1 break-all text-xs text-muted-foreground">Destino: {task.link_url}</p>
              )}
              <div className="mt-3 flex items-center justify-between">
                 <span className="text-primary">+{task.reward_bmh.toLocaleString(numberLocale)} BMH</span>
                <Button disabled={task.completed || busyAction !== null} onClick={() => void handleTaskAction(task)}>
                  {task.completed ? "Concluída" : task.kind === "link_visit" ? "Abrir link" : task.claimable ? "Coletar" : "Fazer tarefa"}
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-20 mx-auto grid max-w-md grid-cols-6 gap-1 border-t border-border bg-background/95 p-2 backdrop-blur">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-xl px-2 py-2 text-[10px] transition ${isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
            >
              <Icon className="mx-auto mb-1 h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </main>
  );
};

export default Index;
