const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bigmarsh-api`;
const API_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type RequestBody = Record<string, unknown>;

export type GameState = {
  user: {
    telegram_id: number;
    username?: string;
    first_name?: string;
    avatar_url?: string;
    bmh_balance: number;
    energy: number;
    max_energy: number;
    level: number;
    daily_streak: number;
    referrals_count: number;
    total_taps: number;
    next_regen_in: number;
    referral_link: string;
  };
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    reward_bmh: number;
    completed: boolean;
    claimable?: boolean;
    kind: "taps_500" | "invite_1";
  }>;
  referrals: Array<{
    telegram_id: number;
    username?: string;
    first_name?: string;
    avatar_url?: string;
    created_at: string;
  }>;
  upgrades: Array<{
    upgrade_type: "marsh_factory" | "viral_boost" | "referral_multiplier";
    level: number;
    next_cost: number;
  }>;
  airdrop_placeholder: string;
};

export async function callBigMarsh<T>(action: string, payload: RequestBody = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(json.error ?? "Erro na API BigMarsh");
  }
  return json as T;
}