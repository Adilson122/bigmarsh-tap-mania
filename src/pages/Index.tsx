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
  const [timedOut, setTimedOut] = useState(false);

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
      setApiStatus(latency > 3000 ? "degraded" : "online");
      setLastSyncAt(new Date());
      setLastLatencyMs(latency);
      setError(null);
      setTimedOut(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao iniciar o app";
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
      bootstrap({ silent: true });
    }, 3000);
    return () => clearInterval(timer);
  }, [state?.user.telegram_id]);

  useEffect(() => {
    if (activeTab === "leaderboard") loadLeaderboard();
  }, [activeTab, lbScope]);

  const onTap = async () => {
    if (!state || state.user.energy <= 0) return;
    const fxId = Date.now();
    try {
      const data = await callBigMarsh<{ tap: { earned_bmh: number }; state: GameState }>("tap", {
        initData,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      setState(data.state);
      setTapFx((prev) => [...prev, { id: fxId, value: data.tap.earned_bmh, x: Math.floor(Math.random() * 120 - 60) }]);
      getTelegramApp()?.HapticFeedback?.impactOccurred("light");
      setTimeout(() => setTapFx((prev) => prev.filter((f) => f.id !== fxId)), 900);
    } catch {}
  };

  const buyUpgrade = async (upgradeType: string) => {
    await callBigMarsh("buy_upgrade", {
      initData,
      upgradeType,
      debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
    });
    await bootstrap();
  };

  const claimTask = async (taskId: string) => {
    await callBigMarsh("claim_task", {
      initData,
      taskId,
      debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
    });
    await bootstrap();
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

  const statusLabel = apiStatus === "online" ? "Online" : apiStatus === "degraded" ? "Lenta" : "Offline";
  const lastSyncLabel = lastSyncAt
    ? lastSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <main className="mx-auto min-h-screen max-w-md px-4 pb-28 pt-4">
      <header className="mb-4 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-glow">
        <h1 className="text-2xl font-bold">BigMarsh - Tap to BMH</h1>
        <p className="text-sm text-muted-foreground">{state.airdrop_placeholder}</p>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                apiStatus === "offline" ? "bg-destructive" : apiStatus === "degraded" ? "bg-muted-foreground" : "bg-primary"
              }`}
            />
            <span className="text-muted-foreground">
              API BigMarsh: <span className={apiStatus === "offline" ? "text-destructive" : "text-foreground"}>{statusLabel}</span>
            </span>
          </div>
          <span className="text-muted-foreground">
            Sync: {lastSyncLabel}
            {lastLatencyMs !== null ? ` · ${lastLatencyMs}ms` : ""}
          </span>
        </div>
        {isRefreshing && <p className="mt-1 text-xs text-muted-foreground">Atualizando...</p>}
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
              <Button className="w-full" onClick={() => buyUpgrade(u.upgrade_type)}>
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
                <Button disabled={task.completed} onClick={() => claimTask(task.id)}>{task.completed ? "Concluída" : "Coletar"}</Button>
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
