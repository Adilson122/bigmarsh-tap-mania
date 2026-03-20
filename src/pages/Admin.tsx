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

const Admin = () => {
  const initData = getTelegramApp()?.initData ?? "";
  const debugUser = useMemo(() => getTelegramUser() ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" }, []);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [snapshot, setSnapshot] = useState<any[]>([]);
  const [query, setQuery] = useState("");
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
          <span className="text-muted-foreground">
            Último sync: {panelSyncLabel}
            {panelLatency !== null ? ` · ${panelLatency}ms` : ""}
          </span>
        </div>
        {panelError && <p className="mt-2 text-xs text-destructive">{panelError}</p>}
      </Card>

      <Card className="grid gap-3 border-border/70 bg-card/85 p-4 md:grid-cols-3">
        <div>Total usuários: <span className="text-primary">{stats?.total_users ?? 0}</span></div>
        <div>Total BMH: <span className="text-primary">{Number(stats?.total_bmh_distributed ?? 0).toLocaleString("pt-BR")}</span></div>
        <div>DAU: <span className="text-primary">{stats?.dau ?? 0}</span></div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <div className="mb-2 flex gap-2">
          <Input placeholder="Buscar usuário" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button disabled={loadingAction !== null} onClick={() => loadPanel(token)}>Buscar</Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Reais: {realUsers.length} · Suspeitos/Fake: {fakeUsers.length}</p>
        <div className="space-y-2">
          {realUsers.map((u) => (
            <div key={u.telegram_id} className="grid grid-cols-6 items-center gap-2 rounded-lg bg-secondary/80 p-2 text-xs">
              <span>{u.first_name ?? u.username ?? u.telegram_id}</span>
              <Input value={u.bmh_balance} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, bmh_balance: Number(e.target.value) } : item))} />
              <Input value={u.energy} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, energy: Number(e.target.value) } : item))} />
              <Input value={u.level} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, level: Number(e.target.value) } : item))} />
              <Button onClick={async () => {
                try {
                  setLoadingAction(`save-${u.telegram_id}`);
                  setPanelError(null);
                  await callBigMarsh("admin_update_user", { adminToken: token, telegramId: u.telegram_id, bmh_balance: u.bmh_balance, energy: u.energy, level: u.level, is_banned: u.is_banned, initData, debugUser });
                  await loadPanel(token);
                } catch (e) {
                  setPanelError(e instanceof Error ? e.message : "Erro ao salvar usuário");
                } finally {
                  setLoadingAction(null);
                }
              }}>Salvar</Button>
              <Button variant="destructive" onClick={async () => {
                try {
                  setLoadingAction(`ban-${u.telegram_id}`);
                  setPanelError(null);
                  await callBigMarsh("admin_update_user", { adminToken: token, telegramId: u.telegram_id, bmh_balance: u.bmh_balance, energy: u.energy, level: u.level, is_banned: !u.is_banned, initData, debugUser });
                  await loadPanel(token);
                } catch (e) {
                  setPanelError(e instanceof Error ? e.message : "Erro ao banir/desbanir");
                } finally {
                  setLoadingAction(null);
                }
              }}>{u.is_banned ? "Desbanir" : "Banir"}</Button>
            </div>
          ))}
          {realUsers.length === 0 && <p className="text-xs text-muted-foreground">Nenhum usuário real encontrado.</p>}
        </div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <p className="mb-2 font-semibold">Usuários suspeitos/fake</p>
        <div className="space-y-2">
          {fakeUsers.map((u) => (
            <div key={u.telegram_id} className="grid grid-cols-6 items-center gap-2 rounded-lg bg-secondary/80 p-2 text-xs">
              <span>{u.first_name ?? u.username ?? u.telegram_id}</span>
              <Input value={u.bmh_balance} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, bmh_balance: Number(e.target.value) } : item))} />
              <Input value={u.energy} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, energy: Number(e.target.value) } : item))} />
              <Input value={u.level} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, level: Number(e.target.value) } : item))} />
              <Button onClick={async () => {
                try {
                  setLoadingAction(`save-fake-${u.telegram_id}`);
                  setPanelError(null);
                  await callBigMarsh("admin_update_user", { adminToken: token, telegramId: u.telegram_id, bmh_balance: u.bmh_balance, energy: u.energy, level: u.level, is_banned: u.is_banned, initData, debugUser });
                  await loadPanel(token);
                } catch (e) {
                  setPanelError(e instanceof Error ? e.message : "Erro ao salvar usuário suspeito");
                } finally {
                  setLoadingAction(null);
                }
              }}>Salvar</Button>
              <Button variant="destructive" onClick={async () => {
                try {
                  setLoadingAction(`ban-fake-${u.telegram_id}`);
                  setPanelError(null);
                  await callBigMarsh("admin_update_user", { adminToken: token, telegramId: u.telegram_id, bmh_balance: u.bmh_balance, energy: u.energy, level: u.level, is_banned: !u.is_banned, initData, debugUser });
                  await loadPanel(token);
                } catch (e) {
                  setPanelError(e instanceof Error ? e.message : "Erro ao banir/desbanir usuário suspeito");
                } finally {
                  setLoadingAction(null);
                }
              }}>{u.is_banned ? "Desbanir" : "Banir"}</Button>
            </div>
          ))}
          {fakeUsers.length === 0 && <p className="text-xs text-muted-foreground">Nenhum usuário suspeito/fake detectado.</p>}
        </div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <p className="mb-2 font-semibold">Referrals</p>
        <div className="space-y-2 text-xs">
          {referrals.map((r) => (
            <div key={r.id} className="rounded-lg bg-secondary/80 px-3 py-2">{r.referrer_id} → {r.referred_id}</div>
          ))}
        </div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <p className="mb-2 font-semibold">Tasks / Upgrades</p>
        <div className="space-y-2 text-xs">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg bg-secondary/80 px-3 py-2">
              <span>{t.title} (+{t.reward_bmh} BMH)</span>
              <Button variant="destructive" onClick={async () => {
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
              }}>Excluir</Button>
            </div>
          ))}
          <Button onClick={async () => {
            try {
              setLoadingAction("create-task");
              setPanelError(null);
              await callBigMarsh("admin_create_task", { adminToken: token, title: "Task custom", reward_bmh: 5000, description: "Task criada pelo admin", kind: "taps_500", initData, debugUser });
              await loadPanel(token);
            } catch (e) {
              setPanelError(e instanceof Error ? e.message : "Erro ao criar task");
            } finally {
              setLoadingAction(null);
            }
          }}>Criar task teste</Button>
        </div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <p className="mb-2 font-semibold">Airdrop Tool (snapshot)</p>
        <div className="space-y-2 text-xs">
          {snapshot.map((u) => (
            <div key={u.telegram_id} className="rounded-lg bg-secondary/80 px-3 py-2">{u.telegram_id} · streak {u.daily_streak} · refs {u.referrals_count}</div>
          ))}
        </div>
      </Card>
    </main>
  );
};

export default Admin;