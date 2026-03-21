import { useMemo, useState } from "react";
import { callBigMarsh } from "@/lib/bigmarsh-api";
import { getTelegramApp, getTelegramUser } from "@/lib/telegram";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AdminUser = {
  telegram_id: number;
  username?: string;
  first_name?: string;
  bmh_balance: number;
  energy: number;
  level: number;
  daily_streak: number;
  referrals_count: number;
  is_banned: boolean;
};

type AdminStats = {
  total_users?: number;
  total_users_including_fake?: number;
  real_users?: number;
  fake_users?: number;
  total_bmh_distributed?: number;
  dau?: number;
};

type TaskSettings = {
  referral_goal: number;
  referral_reward_bmh: number;
  tap_goal: number;
  tap_reward_bmh: number;
};

type AdminTask = {
  id: string;
  title: string;
  reward_bmh: number;
  kind: "taps_500" | "invite_1" | "watch_ad" | "ad_watch" | "link_visit";
  target_value?: number | null;
  link_url?: string | null;
};

type MonetizationPass = {
  pass_type: "weekly" | "monthly";
  title: string;
  duration_days: number;
  price_usd: number;
  benefits: string;
  is_visible: boolean;
  is_enabled: boolean;
  sort_order: number;
};

type AdminTab = "real" | "fake" | "tasks" | "monetization" | "referrals" | "airdrop";

const Admin = () => {
  const initData = getTelegramApp()?.initData ?? "";
  const debugUser = useMemo(() => getTelegramUser() ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" }, []);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [snapshot, setSnapshot] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTab>("real");
  const [newTaskTitle, setNewTaskTitle] = useState("Task custom");
  const [newTaskReward, setNewTaskReward] = useState(500);
  const [newTaskDescription, setNewTaskDescription] = useState("Task criada pelo admin");
  const [newTaskKind, setNewTaskKind] = useState<"taps_500" | "invite_1" | "link_visit">("taps_500");
  const [newTaskTarget, setNewTaskTarget] = useState(500);
  const [newTaskLink, setNewTaskLink] = useState("");
  const [taskSettings, setTaskSettings] = useState<TaskSettings>({
    referral_goal: 1,
    referral_reward_bmh: 500,
    tap_goal: 300,
    tap_reward_bmh: 350,
  });
  const [passes, setPasses] = useState<MonetizationPass[]>([]);
  const [panelStatus, setPanelStatus] = useState<"online" | "degraded" | "offline">("online");
  const [panelLatency, setPanelLatency] = useState<number | null>(null);
  const [panelSyncAt, setPanelSyncAt] = useState<Date | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const isLikelyFakeUser = (u: AdminUser) => {
    const uname = (u.username ?? "").toLowerCase();
    return u.telegram_id >= 900000 || uname.includes("ref_master") || uname.includes("new_marsh") || uname.includes("dev");
  };

  const realUsers = users.filter((u) => !isLikelyFakeUser(u));
  const fakeUsers = users.filter((u) => isLikelyFakeUser(u));

  const loadPanel = async (adminToken: string) => {
    const startedAt = Date.now();
    try {
      setPanelError(null);
      const data = await callBigMarsh<any>("admin_dashboard", { adminToken, initData, debugUser, query });
      const latency = Date.now() - startedAt;
      setPanelStatus(latency > 3000 ? "degraded" : "online");
      setPanelLatency(latency);
      setPanelSyncAt(new Date());
      setStats(data.stats);
      setUsers(data.users);
      setTasks(data.tasks);
      setReferrals(data.referrals);
      setSnapshot(data.snapshot);
      if (data.task_settings) {
        setTaskSettings(data.task_settings);
      }
      setPasses(data.monetization_passes ?? []);
    } catch (e) {
      setPanelStatus("offline");
      setPanelError(e instanceof Error ? e.message : "Erro ao carregar painel");
    }
  };

  const login = async () => {
    try {
      setLoadingAction("login");
      setPanelError(null);
      const data = await callBigMarsh<{ token: string }>("admin_login", { username, password, initData, debugUser });
      setToken(data.token);
      await loadPanel(data.token);
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "Falha no login admin");
    } finally {
      setLoadingAction(null);
    }
  };

  const saveUser = async (u: AdminUser, actionKey: string, nextBanState = u.is_banned) => {
    if (!token) return;
    try {
      setLoadingAction(actionKey);
      setPanelError(null);
      await callBigMarsh("admin_update_user", {
        adminToken: token,
        telegramId: u.telegram_id,
        bmh_balance: u.bmh_balance,
        energy: u.energy,
        level: u.level,
        is_banned: nextBanState,
        initData,
        debugUser,
      });
      await loadPanel(token);
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : "Erro ao salvar usuário");
    } finally {
      setLoadingAction(null);
    }
  };

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <Card className="space-y-4 border-border/70 bg-card/85 p-5">
          <h1 className="text-xl font-semibold">BigMarsh Admin</h1>
          <Input placeholder="Usuário" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {panelError && <p className="text-sm text-destructive">{panelError}</p>}
          <Button disabled={loadingAction !== null} onClick={login}>Entrar</Button>
        </Card>
      </main>
    );
  }

  const panelSyncLabel = panelSyncAt
    ? panelSyncAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";
  const panelStatusLabel = panelStatus === "online" ? "Online" : panelStatus === "degraded" ? "Lenta" : "Offline";

  const usersToRender = activeTab === "fake" ? fakeUsers : realUsers;
  const passByType = (type: "weekly" | "monthly") =>
    passes.find((p) => p.pass_type === type) ?? {
      pass_type: type,
      title: type === "weekly" ? "Passe Semanal" : "Passe Mensal",
      duration_days: type === "weekly" ? 7 : 30,
      price_usd: 0,
      benefits: "",
      is_visible: false,
      is_enabled: false,
      sort_order: type === "weekly" ? 1 : 2,
    };

  const updatePass = (type: "weekly" | "monthly", updater: (base: MonetizationPass) => MonetizationPass) => {
    setPasses((prev) => {
      const existing = prev.find((p) => p.pass_type === type) ?? passByType(type);
      const next = updater(existing);
      const filtered = prev.filter((p) => p.pass_type !== type);
      return [...filtered, next].sort((a, b) => a.sort_order - b.sort_order);
    });
  };

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-4 px-4 py-4">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      <Card className="border-border/70 bg-card/85 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${panelStatus === "offline" ? "bg-destructive" : panelStatus === "degraded" ? "bg-muted-foreground" : "bg-primary"}`} />
            <span className="text-muted-foreground">
              API BigMarsh: <span className={panelStatus === "offline" ? "text-destructive" : "text-foreground"}>{panelStatusLabel}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Último sync: {panelSyncLabel}{panelLatency !== null ? ` · ${panelLatency}ms` : ""}</span>
            <Button size="sm" disabled={loadingAction !== null} onClick={() => void loadPanel(token)}>Atualizar</Button>
          </div>
        </div>
        {panelError && <p className="mt-2 text-xs text-destructive">{panelError}</p>}
      </Card>

      <Card className="grid gap-3 border-border/70 bg-card/85 p-4 md:grid-cols-4">
        <div>Total usuários (reais): <span className="text-primary">{stats?.total_users ?? stats?.real_users ?? 0}</span></div>
        <div>Usuários fake: <span className="text-primary">{stats?.fake_users ?? fakeUsers.length}</span></div>
        <div>Total BMH: <span className="text-primary">{Number(stats?.total_bmh_distributed ?? 0).toLocaleString("pt-BR")}</span></div>
        <div>DAU: <span className="text-primary">{stats?.dau ?? 0}</span></div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <div className="mb-2 flex gap-2">
          <Input placeholder="Buscar usuário" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button disabled={loadingAction !== null} onClick={() => void loadPanel(token)}>Buscar</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Button variant={activeTab === "real" ? "default" : "secondary"} onClick={() => setActiveTab("real")}>Usuários reais</Button>
          <Button variant={activeTab === "fake" ? "default" : "secondary"} onClick={() => setActiveTab("fake")}>Usuários fake</Button>
          <Button variant={activeTab === "tasks" ? "default" : "secondary"} onClick={() => setActiveTab("tasks")}>Tasks</Button>
          <Button variant={activeTab === "monetization" ? "default" : "secondary"} onClick={() => setActiveTab("monetization")}>Monetização</Button>
          <Button variant={activeTab === "referrals" ? "default" : "secondary"} onClick={() => setActiveTab("referrals")}>Referrals</Button>
          <Button variant={activeTab === "airdrop" ? "default" : "secondary"} onClick={() => setActiveTab("airdrop")}>Airdrop</Button>
        </div>
      </Card>

      {(activeTab === "real" || activeTab === "fake") && (
        <Card className="border-border/70 bg-card/85 p-4">
          <p className="mb-2 text-xs text-muted-foreground">{activeTab === "real" ? `Usuários reais: ${realUsers.length}` : `Usuários fake/suspeitos: ${fakeUsers.length}`}</p>
          <div className="space-y-2">
            {usersToRender.map((u) => (
              <div key={u.telegram_id} className="grid grid-cols-1 items-center gap-2 rounded-lg bg-secondary/80 p-2 text-xs md:grid-cols-6">
                <span>{u.first_name ?? u.username ?? u.telegram_id}</span>
                <Input value={u.bmh_balance} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, bmh_balance: Number(e.target.value) } : item))} />
                <Input value={u.energy} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, energy: Number(e.target.value) } : item))} />
                <Input value={u.level} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, level: Number(e.target.value) } : item))} />
                <Button disabled={loadingAction !== null} onClick={() => void saveUser(u, `save-${u.telegram_id}`)}>Salvar</Button>
                <Button
                  variant="destructive"
                  disabled={loadingAction !== null}
                  onClick={() => void saveUser(u, `ban-${u.telegram_id}`, !u.is_banned)}
                >
                  {u.is_banned ? "Desbanir" : "Banir"}
                </Button>
              </div>
            ))}
            {usersToRender.length === 0 && <p className="text-xs text-muted-foreground">Nenhum usuário encontrado nesta aba.</p>}
          </div>
        </Card>
      )}

      {activeTab === "tasks" && (
        <Card className="border-border/70 bg-card/85 p-4">
          <p className="mb-2 font-semibold">Configuração automática de tasks</p>
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <Input
              placeholder="Meta de taps"
              type="number"
              value={taskSettings.tap_goal}
              onChange={(e) => setTaskSettings((prev) => ({ ...prev, tap_goal: Number(e.target.value) }))}
            />
            <Input
              placeholder="Recompensa taps (BMH)"
              type="number"
              value={taskSettings.tap_reward_bmh}
              onChange={(e) => setTaskSettings((prev) => ({ ...prev, tap_reward_bmh: Number(e.target.value) }))}
            />
            <Input
              placeholder="Meta de referrals"
              type="number"
              value={taskSettings.referral_goal}
              onChange={(e) => setTaskSettings((prev) => ({ ...prev, referral_goal: Number(e.target.value) }))}
            />
            <Input
              placeholder="Recompensa referrals (BMH)"
              type="number"
              value={taskSettings.referral_reward_bmh}
              onChange={(e) => setTaskSettings((prev) => ({ ...prev, referral_reward_bmh: Number(e.target.value) }))}
            />
          </div>
          <div className="mb-4">
            <Button
              disabled={loadingAction !== null}
              onClick={async () => {
                try {
                  setLoadingAction("save-task-settings");
                  setPanelError(null);
                  await callBigMarsh("admin_save_task_settings", {
                    adminToken: token,
                    ...taskSettings,
                    initData,
                    debugUser,
                  });
                  await loadPanel(token);
                } catch (e) {
                  setPanelError(e instanceof Error ? e.message : "Erro ao salvar configuração de tasks");
                } finally {
                  setLoadingAction(null);
                }
              }}
            >
              Salvar tasks automáticas
            </Button>
          </div>

          <p className="mb-1 font-semibold">Task manual do dia</p>
          <p className="mb-2 text-xs text-muted-foreground">Tasks de anúncio são automáticas e não devem ser criadas manualmente.</p>
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            <Input placeholder="Título" value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} />
            <Input placeholder="Recompensa BMH" type="number" value={newTaskReward} onChange={(e) => setNewTaskReward(Number(e.target.value))} />
            <Input placeholder="Descrição" value={newTaskDescription} onChange={(e) => setNewTaskDescription(e.target.value)} />
            <Input
              placeholder={newTaskKind === "invite_1" ? "Meta de convites" : newTaskKind === "link_visit" ? "Meta fixa (1)" : "Meta de taps"}
              type="number"
              value={newTaskTarget}
              onChange={(e) => setNewTaskTarget(Number(e.target.value))}
              disabled={newTaskKind === "link_visit"}
            />
            <Input
              placeholder="Link da tarefa (https://...)"
              value={newTaskLink}
              onChange={(e) => setNewTaskLink(e.target.value)}
              disabled={newTaskKind !== "link_visit"}
            />
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={newTaskKind === "taps_500" ? "default" : "secondary"}
                onClick={() => {
                  setNewTaskKind("taps_500");
                  setNewTaskTarget((prev) => (prev <= 0 ? 500 : prev));
                }}
              >
                Tap
              </Button>
              <Button
                variant={newTaskKind === "invite_1" ? "default" : "secondary"}
                onClick={() => {
                  setNewTaskKind("invite_1");
                  setNewTaskTarget((prev) => (prev <= 0 ? 1 : prev));
                }}
              >
                Referral
              </Button>
              <Button
                variant={newTaskKind === "link_visit" ? "default" : "secondary"}
                onClick={() => {
                  setNewTaskKind("link_visit");
                  setNewTaskTarget(1);
                }}
              >
                Link
              </Button>
            </div>
          </div>
          <div className="mb-4">
            <Button
              disabled={loadingAction !== null}
              onClick={async () => {
                try {
                  setLoadingAction("create-task");
                  setPanelError(null);
                  await callBigMarsh("admin_create_task", {
                    adminToken: token,
                    title: newTaskTitle,
                    reward_bmh: newTaskReward,
                    description: newTaskDescription,
                    kind: newTaskKind,
                    targetValue: newTaskTarget,
                     linkUrl: newTaskKind === "link_visit" ? newTaskLink : null,
                    initData,
                    debugUser,
                  });
                  await loadPanel(token);
                } catch (e) {
                  setPanelError(e instanceof Error ? e.message : "Erro ao criar task");
                } finally {
                  setLoadingAction(null);
                }
              }}
            >
              Salvar task
            </Button>
          </div>
          <div className="space-y-2 text-xs">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-secondary/80 px-3 py-2">
                <span>
                  {t.title} ({t.target_value ?? "-"}) (+{t.reward_bmh} BMH)
                  {t.kind === "link_visit" && t.link_url ? ` · ${t.link_url}` : ""}
                </span>
                <Button
                  variant="destructive"
                  disabled={loadingAction !== null}
                  onClick={async () => {
                    try {
                      setLoadingAction(`delete-task-${t.id}`);
                      setPanelError(null);
                      await callBigMarsh("admin_delete_task", { adminToken: token, taskId: t.id, initData, debugUser });
                      await loadPanel(token);
                    } catch (e) {
                      setPanelError(e instanceof Error ? e.message : "Erro ao excluir task");
                    } finally {
                      setLoadingAction(null);
                    }
                  }}
                >
                  Excluir
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "monetization" && (
        <Card className="border-border/70 bg-card/85 p-4">
          <p className="mb-2 font-semibold">Passes (USD)</p>
          <div className="space-y-4">
            {(["weekly", "monthly"] as const).map((type) => {
              const pass = passByType(type);
              return (
                <div key={type} className="rounded-lg bg-secondary/80 p-3 text-xs">
                  <p className="mb-2 font-semibold">{type === "weekly" ? "Passe Semanal" : "Passe Mensal"}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input value={pass.title} onChange={(e) => updatePass(type, (base) => ({ ...base, title: e.target.value }))} />
                    <Input
                      type="number"
                      value={pass.price_usd}
                      onChange={(e) => updatePass(type, (base) => ({ ...base, price_usd: Number(e.target.value) }))}
                    />
                    <Input
                      type="number"
                      value={pass.duration_days}
                      onChange={(e) => updatePass(type, (base) => ({ ...base, duration_days: Number(e.target.value) }))}
                    />
                    <Input
                      value={pass.benefits}
                      onChange={(e) => updatePass(type, (base) => ({ ...base, benefits: e.target.value }))}
                      placeholder="Vantagens"
                    />
                    <Button
                      variant={pass.is_enabled ? "default" : "secondary"}
                      onClick={() => updatePass(type, (base) => ({ ...base, is_enabled: !base.is_enabled }))}
                    >
                      {pass.is_enabled ? "Ativado" : "Desativado"}
                    </Button>
                    <Button
                      variant={pass.is_visible ? "default" : "secondary"}
                      onClick={() => updatePass(type, (base) => ({ ...base, is_visible: !base.is_visible }))}
                    >
                      {pass.is_visible ? "Visível" : "Oculto"}
                    </Button>
                  </div>
                  <Button
                    className="mt-2"
                    disabled={loadingAction !== null}
                    onClick={async () => {
                      try {
                        setLoadingAction(`save-pass-${type}`);
                        setPanelError(null);
                        await callBigMarsh("admin_save_pass", {
                          adminToken: token,
                          ...pass,
                          initData,
                          debugUser,
                        });
                        await loadPanel(token);
                      } catch (e) {
                        setPanelError(e instanceof Error ? e.message : "Erro ao salvar passe");
                      } finally {
                        setLoadingAction(null);
                      }
                    }}
                  >
                    Salvar passe
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {activeTab === "referrals" && (
        <Card className="border-border/70 bg-card/85 p-4">
          <p className="mb-2 font-semibold">Referrals</p>
          <div className="space-y-2 text-xs">
            {referrals.map((r) => (
              <div key={r.id} className="rounded-lg bg-secondary/80 px-3 py-2">{r.referrer_id} → {r.referred_id}</div>
            ))}
          </div>
        </Card>
      )}

      {activeTab === "airdrop" && (
        <Card className="border-border/70 bg-card/85 p-4">
          <p className="mb-2 font-semibold">Airdrop Tool (snapshot)</p>
          <div className="space-y-2 text-xs">
            {snapshot.map((u) => (
              <div key={u.telegram_id} className="rounded-lg bg-secondary/80 px-3 py-2">{u.telegram_id} · streak {u.daily_streak} · refs {u.referrals_count}</div>
            ))}
          </div>
        </Card>
      )}
    </main>
  );
};

export default Admin;