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

  const loadPanel = async (adminToken: string) => {
    const data = await callBigMarsh<any>("admin_dashboard", { adminToken, initData, debugUser, query });
    setStats(data.stats);
    setUsers(data.users);
    setTasks(data.tasks);
    setReferrals(data.referrals);
    setSnapshot(data.snapshot);
  };

  const login = async () => {
    const data = await callBigMarsh<{ token: string }>("admin_login", { username, password, initData, debugUser });
    setToken(data.token);
    await loadPanel(data.token);
  };

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <Card className="space-y-4 border-border/70 bg-card/85 p-5">
          <h1 className="text-xl font-semibold">BigMarsh Admin</h1>
          <Input placeholder="Usuário" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button onClick={login}>Entrar</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-4 px-4 py-4">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      <Card className="grid gap-3 border-border/70 bg-card/85 p-4 md:grid-cols-3">
        <div>Total usuários: <span className="text-primary">{stats?.total_users ?? 0}</span></div>
        <div>Total BMH: <span className="text-primary">{Number(stats?.total_bmh_distributed ?? 0).toLocaleString("pt-BR")}</span></div>
        <div>DAU: <span className="text-primary">{stats?.dau ?? 0}</span></div>
      </Card>

      <Card className="border-border/70 bg-card/85 p-4">
        <div className="mb-2 flex gap-2">
          <Input placeholder="Buscar usuário" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button onClick={() => loadPanel(token)}>Buscar</Button>
        </div>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.telegram_id} className="grid grid-cols-6 items-center gap-2 rounded-lg bg-secondary/80 p-2 text-xs">
              <span>{u.first_name ?? u.username ?? u.telegram_id}</span>
              <Input value={u.bmh_balance} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, bmh_balance: Number(e.target.value) } : item))} />
              <Input value={u.energy} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, energy: Number(e.target.value) } : item))} />
              <Input value={u.level} onChange={(e) => setUsers((prev) => prev.map((item) => item.telegram_id === u.telegram_id ? { ...item, level: Number(e.target.value) } : item))} />
              <Button onClick={async () => {
                await callBigMarsh("admin_update_user", { adminToken: token, telegramId: u.telegram_id, bmh_balance: u.bmh_balance, energy: u.energy, level: u.level, is_banned: u.is_banned, initData, debugUser });
                await loadPanel(token);
              }}>Salvar</Button>
              <Button variant="destructive" onClick={async () => {
                await callBigMarsh("admin_update_user", { adminToken: token, telegramId: u.telegram_id, bmh_balance: u.bmh_balance, energy: u.energy, level: u.level, is_banned: !u.is_banned, initData, debugUser });
                await loadPanel(token);
              }}>{u.is_banned ? "Desbanir" : "Banir"}</Button>
            </div>
          ))}
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
                await callBigMarsh("admin_delete_task", { adminToken: token, taskId: t.id, initData, debugUser });
                await loadPanel(token);
              }}>Excluir</Button>
            </div>
          ))}
          <Button onClick={async () => {
            await callBigMarsh("admin_create_task", { adminToken: token, title: "Task custom", reward_bmh: 5000, description: "Task criada pelo admin", kind: "taps_500", initData, debugUser });
            await loadPanel(token);
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