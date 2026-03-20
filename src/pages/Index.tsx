import { useEffect, useMemo, useState } from "react";
import { Trophy, Zap, Users, ListChecks, ArrowUpCircle, Sparkles } from "lucide-react";
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

type TabKey = "tap" | "upgrades" | "referrals" | "leaderboard" | "tasks";

const tabs: Array<{ key: TabKey; label: string; icon: typeof Zap }> = [
  { key: "tap", label: "Tap", icon: Zap },
  { key: "upgrades", label: "Upgrades", icon: ArrowUpCircle },
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
  const [busyAction, setBusyAction] = useState<"tap" | "upgrade" | "task" | "referral_copy" | "referral_share" | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [accountBlocked, setAccountBlocked] = useState(false);

  const telegramUser = useMemo(() => getTelegramUser(), []);
  const initData = getTelegramApp()?.initData ?? "";

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
          text: "Vem jogar BigMarsh comigo!",
          url: state.user.referral_link,
        });
      } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(state.user.referral_link)}&text=${encodeURIComponent("Vem jogar BigMarsh comigo!")}`, "_blank", "noopener,noreferrer");
      }
    } catch {
      setActionError("Não foi possível compartilhar agora.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleTaskAction = async (task: GameState["tasks"][number]) => {
    if (task.completed) return;
    if (task.claimable) {
      await claimTask(task.id);
      return;
    }

    if (task.kind === "invite_1") {
      setActiveTab("referrals");
      return;
    }

    setActiveTab("tap");
  };

  if (isBootstrapping && !state) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-card/85 p-5 text-center">
          <p className="text-base font-medium text-foreground">Conectando BigMarsh...</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {timedOut ? "A conexão expirou." : "Sincronizando sua conta no Telegram."}
          </p>
          {(timedOut || error) && (
            <Button className="mt-4 w-full" onClick={() => bootstrap({ silent: false })}>
              Tentar novamente
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
            <span className="text-muted-foreground">Status da conta: </span>
            <span className="font-semibold text-destructive">Bloqueada</span>
          </div>
          <h1 className="text-lg font-semibold">Sua conta está temporariamente bloqueada</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Não se preocupe: seus dados foram preservados. Entre em contato com o suporte/admin para revisão.
          </p>
          <Button className="mt-4 w-full" onClick={() => bootstrap({ silent: false })}>
            Tentar novamente
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
        {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>Nível {state.user.level}</span>
          <span className="font-semibold text-primary">{state.user.bmh_balance.toLocaleString("pt-BR")} BMH</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(state.user.energy / state.user.max_energy) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Energia {state.user.energy}/{state.user.max_energy} · +1 em {state.user.next_regen_in}s</p>
      </header>

      {activeTab === "tap" && (
        <section className="space-y-4">
          <Card className="relative overflow-hidden border-border/70 bg-card/85 p-6 text-center">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Combo ativo e haptics Telegram</p>
            <button onClick={onTap} className="relative mx-auto flex h-52 w-52 items-center justify-center rounded-full border border-primary/70 bg-secondary text-8xl shadow-glow transition-transform active:scale-95" aria-label="Tap no Marsh">
              🐹
              <span className="pointer-events-none absolute inset-0 rounded-full border border-primary/60 animate-pulseTap" />
            </button>
            {tapFx.map((f) => (
              <span key={f.id} className="pointer-events-none absolute left-1/2 top-20 animate-rise text-lg font-bold text-primary" style={{ transform: `translateX(${f.x}px)` }}>
                +{f.value} BMH
              </span>
            ))}
          </Card>
          <Card className="border-border/70 bg-card/85 p-4 text-sm">
            <p>Streak diário: <span className="font-semibold text-primary">{state.user.daily_streak} dias</span></p>
            <p>Taps totais: {state.user.total_taps.toLocaleString("pt-BR")}</p>
          </Card>
        </section>
      )}

      {activeTab === "upgrades" && (
        <section className="space-y-3">
          {state.upgrades.map((u) => (
            <Card key={u.upgrade_type} className="border-border/70 bg-card/85 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold capitalize">{u.upgrade_type.replace("_", " ")}</h2>
                <span className="text-sm text-primary">Lv {u.level}</span>
              </div>
              <Button className="w-full" disabled={busyAction !== null} onClick={() => buyUpgrade(u.upgrade_type)}>
                Comprar ({u.next_cost.toLocaleString("pt-BR")} BMH)
              </Button>
            </Card>
          ))}
        </section>
      )}

      {activeTab === "referrals" && (
        <section className="space-y-3">
          <Card className="border-border/70 bg-card/85 p-4">
            <p className="text-sm text-muted-foreground">Link único</p>
            <p className="mt-1 break-all text-sm">{state.user.referral_link}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busyAction !== null} onClick={copyReferralLink}>Copiar link</Button>
              <Button disabled={busyAction !== null} onClick={shareReferralLink}>Compartilhar</Button>
            </div>
            <Button className="mt-2 w-full" variant="outline" disabled>
              Conectar carteira (em breve)
            </Button>
          </Card>
          <Card className="border-border/70 bg-card/85 p-4">
            <p className="mb-2 font-semibold">Amigos indicados ({state.referrals.length})</p>
            <div className="space-y-2 text-sm">
              {state.referrals.map((r) => (
                <div key={r.telegram_id} className="flex items-center justify-between rounded-lg bg-secondary/70 px-3 py-2">
                  <span>{r.first_name ?? r.username ?? `#${r.telegram_id}`}</span>
                  <span className="text-primary">+5% eterno</span>
                </div>
              ))}
              {state.referrals.length === 0 && <p className="text-muted-foreground">Nenhum convidado ainda.</p>}
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
                  <span className="font-semibold text-primary">{(lbScope === "weekly" ? row.weekly_bmh : row.bmh_balance).toLocaleString("pt-BR")} BMH</span>
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
              <div className="mt-3 flex items-center justify-between">
                <span className="text-primary">+{task.reward_bmh.toLocaleString("pt-BR")} BMH</span>
                <Button disabled={task.completed || busyAction !== null} onClick={() => void handleTaskAction(task)}>
                  {task.completed ? "Concluída" : task.claimable ? "Coletar" : "Fazer tarefa"}
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-20 mx-auto grid max-w-md grid-cols-5 gap-1 border-t border-border bg-background/95 p-2 backdrop-blur">
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
