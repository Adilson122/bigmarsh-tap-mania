import { useEffect, useMemo, useState } from "react";
import { Trophy, Zap, Users, ListChecks, ArrowUpCircle, Sparkles, Wallet } from "lucide-react";
import { useTonAddress, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { callBigMarsh, type GameState } from "@/lib/bigmarsh-api";
import { getStartParam, getTelegramApp, getTelegramUser, setupTelegram } from "@/lib/telegram";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { WalletStatusDisplay } from "@/components/wallet/WalletStatusDisplay";
import { BuyPassButton } from "@/components/wallet/BuyPassButton";

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

type WalletSignature = {
  signature: string;
  address: string;
  timestamp: number;
  domain: string;
  payload: unknown;
};

type BuyPassType = "weekly" | "monthly";

const tabs: Array<{ key: TabKey; icon: typeof Zap }> = [
  { key: "tap", icon: Zap },
  { key: "upgrades", icon: ArrowUpCircle },
  { key: "passes", icon: Sparkles },
  { key: "referrals", icon: Users },
  { key: "leaderboard", icon: Trophy },
  { key: "tasks", icon: ListChecks },
];

const BOOT_TIMEOUT_MS = 8000;
const TON_PASS_RECEIVER = "UQDtR-mDIsrdfG1PVtn9CZHY1BDqJspdPa-ND-XxqcrLAcMd";
const TON_PASS_COMMENT = "Compra de passe do Mini App";

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

const normalizeWalletAddressInput = (value: string) => {
  let normalized = value.trim();
  if (!normalized) return "";

  normalized = normalized.replace(/^ton:\/\/transfer\//i, "");
  normalized = normalized.replace(/^https?:\/\/(?:app\.)?tonkeeper\.com\/transfer\//i, "");
  normalized = normalized.replace(/^https?:\/\/tonhub\.com\/transfer\//i, "");

  if (normalized.includes("?")) {
    normalized = normalized.split("?")[0] ?? normalized;
  }

  return normalized.trim();
};

const upgradeMeta: Record<GameState["upgrades"][number]["upgrade_type"], { title: string; description: Record<Locale, string> }> = {
  marsh_factory: {
    title: "Marsh Factory",
    description: {
      en: "Boosts your base BMH gain per tap.",
      pt: "Aumenta seu ganho base de BMH por tap.",
      es: "Aumenta tu ganancia base de BMH por tap.",
    },
  },
  viral_boost: {
    title: "Viral Boost",
    description: {
      en: "Improves combo multiplier growth.",
      pt: "Melhora o crescimento do multiplicador de combo.",
      es: "Mejora el crecimiento del multiplicador de combo.",
    },
  },
  referral_multiplier: {
    title: "Referral Multiplier",
    description: {
      en: "Increases rewards from active referrals.",
      pt: "Aumenta as recompensas das indicações ativas.",
      es: "Aumenta las recompensas de referidos activos.",
    },
  },
  energy_core: {
    title: "Energy Core",
    description: {
      en: "Raises max energy so you can play longer.",
      pt: "Eleva a energia máxima para jogar mais tempo.",
      es: "Aumenta la energía máxima para jugar más tiempo.",
    },
  },
  precision_tap: {
    title: "Precision Tap",
    description: {
      en: "Increases tap efficiency and total gain.",
      pt: "Aumenta a eficiência do tap e ganho total.",
      es: "Aumenta la eficiencia del tap y la ganancia total.",
    },
  },
};

const messages: Record<Locale, Record<string, string>> = {
  en: {
    appTitle: "BigMarsh - Tap to BMH",
    tabs_tap: "Tap",
    tabs_upgrades: "Upgrades",
    tabs_passes: "Passes",
    tabs_referrals: "Referrals",
    tabs_leaderboard: "Leaderboard",
    tabs_tasks: "Tasks",
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
    disconnectWallet: "Disconnect",
    disconnected: "Disconnected",
    connectingWallet: "Connecting...",
    walletHint: "Link your TON address to buy passes and join airdrops.",
    walletHintTonConnect: "Use TON Connect to link your wallet securely in-app.",
    walletPlaceholder: "Paste your TON address",
    updateWallet: "Update wallet",
    linkedWallet: "Connected",
    verifyAndLink: "Verify & link wallet",
    openWalletPicker: "Open wallet picker",
    walletSignatureError: "Your wallet did not sign the verification request.",
    walletConnectedNotLinked: "Wallet connected. Finish verification to link it with your account.",
    copyLink: "Copy link",
    share: "Share",
    referredFriends: "Referred friends",
    noReferredFriends: "No invited friends yet.",
    goToWallet: "Go connect wallet",
    dailyStreak: "Daily streak",
    days: "days",
    totalTaps: "Total taps",
    collect: "Collect",
    completed: "Completed",
    doTask: "Do task",
    watchAd: "Watch ad",
    openLink: "Open link",
    calendarTitle: "30-day login calendar",
    inviteBonus: "Lifetime +5%",
    taskDestination: "Destination",
    buyNow: "Buy now",
    buyPass: "Buy Pass",
    checkoutStarted: "Checkout started",
    paymentComment: "Transfer comment",
    paymentStatus: "Payment",
    paid: "Paid",
    unpaid: "Unpaid",
    paymentProcessing: "Processing payment...",
    paymentSuccess: "Payment completed successfully!",
    txHashPlaceholder: "Transaction hash (optional)",
    confirmPayment: "Confirm payment",
    noPasses: "No passes available right now.",
    activePasses: "Active passes",
    weeklyPass: "Weekly",
    monthlyPass: "Monthly",
    activeUntil: "active until",
    durationDays: "Duration",
    adCooldown: "This ad is recharging. Try again in a moment.",
    adUnavailable: "Ad is unavailable right now.",
    adTelegramOnly: "Ad tasks work only inside Telegram.",
    invalidAdSlot: "Invalid ad slot.",
    adLoadError: "Could not load this ad right now.",
    adCompletedCollect: "Ad completed. Tap Collect to claim your BMH.",
    appLoadError: "Failed to load",
    upgradeBuy: "Buy",
    inSeconds: "in",
    goConnectWallet: "Go connect wallet",
    uniqueLink: "Unique link",
    tasksAutoRefresh: "Watch ad and claim BMH. Slot auto-refreshes.",
    allTime: "All-Time",
    weekly: "Weekly",
    friends: "Friends",
    connectWalletTitle: "Connect Wallet",
    buyPassNeedWallet: "Connect your wallet before buying a pass.",
    checkoutNotConfigured: "TON checkout is not configured in admin yet.",
    checkoutStartError: "Failed to start checkout.",
    confirmError: "Failed to confirm purchase.",
    checkoutExpired: "Checkout expired. Start a new purchase.",
    walletRequired: "Enter your TON wallet address.",
    walletInvalid: "Invalid wallet address.",
    walletConnectError: "Could not connect wallet.",
    taskClaimError: "Failed to claim task.",
    tapError: "Tap is unavailable right now.",
    upgradeError: "Failed to buy upgrade.",
    copyError: "Could not copy link now.",
    shareError: "Could not share right now.",
    loadingAdHint: "Ads are provided by Monetag and may vary by region.",
    openTelegramWallet: "Open Telegram Wallet",
    airdropPlaceholder: "Airdrop BMH coming soon for active players",
    excitingShare: "🚀 I just started farming BMH on BigMarsh! Fast taps, ad boosts, weekly missions and TON passes. Join me now and claim your starter bonus!",
  },
  pt: {
    appTitle: "BigMarsh - Tap to BMH",
    tabs_tap: "Tap",
    tabs_upgrades: "Upgrades",
    tabs_passes: "Passes",
    tabs_referrals: "Referrals",
    tabs_leaderboard: "Leaderboard",
    tabs_tasks: "Tarefas",
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
    disconnectWallet: "Desconectar",
    disconnected: "Desconectada",
    connectingWallet: "Conectando...",
    walletHint: "Vincule seu endereço TON para comprar passes e participar do airdrop.",
    walletHintTonConnect: "Use o TON Connect para vincular sua carteira com segurança no app.",
    walletPlaceholder: "Cole seu endereço TON",
    updateWallet: "Atualizar carteira",
    linkedWallet: "Conectada",
    verifyAndLink: "Verificar e vincular",
    openWalletPicker: "Abrir seletor de carteira",
    walletSignatureError: "Sua carteira não assinou a solicitação de verificação.",
    walletConnectedNotLinked: "Carteira conectada. Finalize a verificação para vincular à sua conta.",
    copyLink: "Copiar link",
    share: "Compartilhar",
    referredFriends: "Amigos indicados",
    noReferredFriends: "Nenhum convidado ainda.",
    goToWallet: "Ir para conectar carteira",
    dailyStreak: "Streak diário",
    days: "dias",
    totalTaps: "Taps totais",
    collect: "Coletar",
    completed: "Concluída",
    doTask: "Fazer tarefa",
    watchAd: "Assistir anúncio",
    openLink: "Abrir link",
    calendarTitle: "Calendário de login (30 dias)",
    inviteBonus: "+5% vitalício",
    taskDestination: "Destino",
    buyNow: "Comprar agora",
    buyPass: "Comprar Passe",
    checkoutStarted: "Checkout iniciado",
    paymentComment: "Comentário da transferência",
    paymentStatus: "Pagamento",
    paid: "Pagou",
    unpaid: "Não pago",
    paymentProcessing: "Processando pagamento...",
    paymentSuccess: "Pagamento concluído com sucesso!",
    txHashPlaceholder: "Hash da transação (opcional)",
    confirmPayment: "Confirmar pagamento",
    noPasses: "Nenhum passe disponível no momento.",
    activePasses: "Passes ativos",
    weeklyPass: "Semanal",
    monthlyPass: "Mensal",
    activeUntil: "ativo até",
    durationDays: "Duração",
    adCooldown: "Esse anúncio está em recarga. Tente em instantes.",
    adUnavailable: "Anúncio indisponível no momento.",
    adTelegramOnly: "Essas tarefas de anúncio só funcionam dentro do Telegram.",
    invalidAdSlot: "Slot de anúncio inválido.",
    adLoadError: "Não foi possível carregar o anúncio agora.",
    adCompletedCollect: "Anúncio concluído. Toque em Coletar para receber seu BMH.",
    appLoadError: "Falha ao carregar",
    upgradeBuy: "Comprar",
    inSeconds: "em",
    goConnectWallet: "Ir para conectar carteira",
    uniqueLink: "Link único",
    tasksAutoRefresh: "Assista ao anúncio e colete BMH. O slot recarrega automaticamente.",
    allTime: "Geral",
    weekly: "Semanal",
    friends: "Amigos",
    connectWalletTitle: "Conectar Wallet",
    buyPassNeedWallet: "Conecte sua carteira antes de comprar um passe.",
    checkoutNotConfigured: "Checkout TON ainda não configurado no painel admin.",
    checkoutStartError: "Falha ao iniciar checkout.",
    confirmError: "Falha ao confirmar compra.",
    checkoutExpired: "Checkout expirou. Inicie a compra novamente.",
    walletRequired: "Informe o endereço da sua carteira TON.",
    walletInvalid: "Endereço de carteira inválido.",
    walletConnectError: "Não foi possível conectar a carteira.",
    taskClaimError: "Falha ao coletar task.",
    tapError: "Não foi possível tapar agora.",
    upgradeError: "Falha ao comprar upgrade.",
    copyError: "Não foi possível copiar o link agora.",
    shareError: "Não foi possível compartilhar agora.",
    loadingAdHint: "Os anúncios são fornecidos pela Monetag e podem variar por região.",
    openTelegramWallet: "Abrir Telegram Wallet",
    airdropPlaceholder: "Airdrop BMH em breve para jogadores ativos",
    excitingShare: "🚀 Entrei no BigMarsh e já estou farmando BMH! Tap rápido, boost por anúncios, missões semanais e passes TON. Entra comigo agora e pega seu bônus inicial!",
  },
  es: {
    appTitle: "BigMarsh - Tap to BMH",
    tabs_tap: "Tap",
    tabs_upgrades: "Mejoras",
    tabs_passes: "Pases",
    tabs_referrals: "Referidos",
    tabs_leaderboard: "Ranking",
    tabs_tasks: "Tareas",
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
    disconnectWallet: "Desconectar",
    disconnected: "Desconectada",
    connectingWallet: "Conectando...",
    walletHint: "Vincula tu dirección TON para comprar pases y entrar al airdrop.",
    walletHintTonConnect: "Usa TON Connect para vincular tu billetera de forma segura dentro de la app.",
    walletPlaceholder: "Pega tu dirección TON",
    updateWallet: "Actualizar billetera",
    linkedWallet: "Conectada",
    verifyAndLink: "Verificar y vincular",
    openWalletPicker: "Abrir selector de billetera",
    walletSignatureError: "Tu billetera no firmó la solicitud de verificación.",
    walletConnectedNotLinked: "Billetera conectada. Completa la verificación para vincularla con tu cuenta.",
    copyLink: "Copiar enlace",
    share: "Compartir",
    referredFriends: "Amigos referidos",
    noReferredFriends: "Aún no hay amigos invitados.",
    goToWallet: "Ir a conectar billetera",
    dailyStreak: "Racha diaria",
    days: "días",
    totalTaps: "Taps totales",
    collect: "Cobrar",
    completed: "Completada",
    doTask: "Hacer tarea",
    watchAd: "Ver anuncio",
    openLink: "Abrir enlace",
    calendarTitle: "Calendario de login (30 días)",
    inviteBonus: "+5% vitalicio",
    taskDestination: "Destino",
    buyNow: "Comprar ahora",
    buyPass: "Comprar Pase",
    checkoutStarted: "Checkout iniciado",
    paymentComment: "Comentario de transferencia",
    paymentStatus: "Pago",
    paid: "Pagado",
    unpaid: "No pagado",
    paymentProcessing: "Procesando pago...",
    paymentSuccess: "¡Pago completado con éxito!",
    txHashPlaceholder: "Hash de transacción (opcional)",
    confirmPayment: "Confirmar pago",
    noPasses: "No hay pases disponibles ahora.",
    activePasses: "Pases activos",
    weeklyPass: "Semanal",
    monthlyPass: "Mensual",
    activeUntil: "activo hasta",
    durationDays: "Duración",
    adCooldown: "Este anuncio está recargando. Intenta en un momento.",
    adUnavailable: "Anuncio no disponible ahora.",
    adTelegramOnly: "Estas tareas de anuncios solo funcionan dentro de Telegram.",
    invalidAdSlot: "Slot de anuncio inválido.",
    adLoadError: "No se pudo cargar el anuncio ahora.",
    adCompletedCollect: "Anuncio completado. Toca Cobrar para recibir tu BMH.",
    appLoadError: "Error al cargar",
    upgradeBuy: "Comprar",
    inSeconds: "en",
    goConnectWallet: "Ir a conectar billetera",
    uniqueLink: "Enlace único",
    tasksAutoRefresh: "Mira anuncio y cobra BMH. El slot se recarga automáticamente.",
    allTime: "Global",
    weekly: "Semanal",
    friends: "Amigos",
    connectWalletTitle: "Conectar Wallet",
    buyPassNeedWallet: "Conecta tu billetera antes de comprar un pase.",
    checkoutNotConfigured: "El checkout TON aún no está configurado en admin.",
    checkoutStartError: "Error al iniciar checkout.",
    confirmError: "Error al confirmar compra.",
    checkoutExpired: "El checkout expiró. Inicia una nueva compra.",
    walletRequired: "Ingresa la dirección de tu billetera TON.",
    walletInvalid: "Dirección de billetera inválida.",
    walletConnectError: "No se pudo conectar la billetera.",
    taskClaimError: "Error al cobrar tarea.",
    tapError: "No se pudo hacer tap ahora.",
    upgradeError: "Error al comprar mejora.",
    copyError: "No se pudo copiar el enlace ahora.",
    shareError: "No se pudo compartir ahora.",
    loadingAdHint: "Los anuncios son provistos por Monetag y pueden variar por región.",
    openTelegramWallet: "Abrir Telegram Wallet",
    airdropPlaceholder: "Airdrop de BMH muy pronto para jugadores activos",
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
  const [adReadyToCollect, setAdReadyToCollect] = useState<Record<string, true>>({});
  const [paymentMarkedAsPaid, setPaymentMarkedAsPaid] = useState(false);
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem("bigmarsh_locale");
    return saved === "pt" || saved === "es" || saved === "en" ? saved : "en";
  });

  const telegramUser = useMemo(() => getTelegramUser(), []);
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const tonRawAddress = useTonAddress(false);
  const initData = getTelegramApp()?.initData ?? "";
  const copy = messages[locale];
  const numberLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";
  const tabLabels: Record<TabKey, string> = {
    tap: copy.tabs_tap,
    upgrades: copy.tabs_upgrades,
    passes: copy.tabs_passes,
    referrals: copy.tabs_referrals,
    leaderboard: copy.tabs_leaderboard,
    tasks: copy.tabs_tasks,
  };

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
      setAdReadyToCollect((prev) => {
        const valid = new Set((data.state.tasks ?? []).map((task) => String(task.id)));
        return Object.fromEntries(Object.keys(prev).filter((id) => valid.has(id)).map((id) => [id, true])) as Record<string, true>;
      });
      setAccountBlocked(false);
      setApiStatus(latency > 3000 ? "degraded" : "online");
      setLastSyncAt(new Date());
      setLastLatencyMs(latency);
      setError(null);
      setTimedOut(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : copy.appLoadError;

      if (msg === "user_banned") {
        setAccountBlocked(true);
        setError(null);
        setTimedOut(false);
        return;
      }

      setApiStatus("offline");

      if (msg === "timeout") {
        setTimedOut(true);
        setError(copy.timeout);
      } else {
        setError(copy.appLoadError);
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
      const msg = e instanceof Error ? e.message : copy.tapError;
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
      const msg = e instanceof Error ? e.message : copy.upgradeError;
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
      const msg = e instanceof Error ? e.message : copy.taskClaimError;
      if (msg === "user_banned") {
        setAccountBlocked(true);
        setActionError(null);
      } else if (msg === "insufficient_balance") {
        setActionError(msg);
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
      setActionError(copy.copyError);
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
      setActionError(copy.shareError);
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
      const msg = e instanceof Error ? e.message : copy.adLoadError;
      if (msg === "user_banned") {
        setAccountBlocked(true);
        setActionError(null);
      } else if (msg === "ad_not_claimable_yet") {
        setActionError(copy.adCooldown);
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const connectWalletWithTonConnect = async () => {
    if (!state) return;
    const address = normalizeWalletAddressInput(tonRawAddress);
    if (!address) {
      setActionError(copy.walletRequired);
      return;
    }

    try {
      setBusyAction("wallet");
      setActionError(null);

      let signaturePayload: WalletSignature | null = null;
      try {
        const signed = await tonConnectUI.signData({
          type: "text",
          text: `BigMarsh wallet verification\nUser: ${state.user.telegram_id}\nTimestamp: ${new Date().toISOString()}`,
        });
        signaturePayload = {
          signature: signed.signature,
          address: signed.address,
          timestamp: signed.timestamp,
          domain: signed.domain,
          payload: signed.payload,
        };
      } catch {
        throw new Error("wallet_signature_required");
      }

      await callBigMarsh("connect_wallet", {
        initData,
        walletAddress: address,
        walletSignature: signaturePayload,
        debugUser: telegramUser ?? { id: 777001, first_name: "Dev", username: "bigmarsh_dev" },
      });
      await bootstrap({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : copy.walletConnectError;
      if (msg === "wallet_address_invalid") {
        setActionError(copy.walletInvalid);
      } else if (msg === "wallet_signature_required") {
        setActionError(copy.walletSignatureError);
      } else {
        setActionError(msg);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const isTonWalletLinked = Boolean(state?.user.wallet_address && tonRawAddress && normalizeWalletAddressInput(state.user.wallet_address) === normalizeWalletAddressInput(tonRawAddress));

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
      const msg = e instanceof Error ? e.message : copy.checkoutStartError;
      if (msg === "wallet_not_connected") {
        setActionError(copy.buyPassNeedWallet);
      } else if (msg === "checkout_receiver_not_configured") {
        setActionError(copy.checkoutNotConfigured);
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
      const msg = e instanceof Error ? e.message : copy.confirmError;
      if (msg === "purchase_expired") {
        setActionError(copy.checkoutExpired);
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
      const taskId = String(task.id);
      if (adReadyToCollect[taskId]) {
        if (taskId.startsWith("ad_slot_")) {
          const slotNo = Number(taskId.replace("ad_slot_", ""));
          if (Number.isFinite(slotNo) && slotNo >= 1 && slotNo <= 10) {
            await claimAdSlot(slotNo);
            setAdReadyToCollect((prev) => {
              const next = { ...prev };
              delete next[taskId];
              return next;
            });
          } else {
            setActionError(copy.invalidAdSlot);
          }
        }
        return;
      }

      if (!task.claimable) {
        setActionError(copy.adCooldown);
        return;
      }

      const monetagSdk = await loadMonetagSdk();
      if (!monetagSdk) {
        setActionError(copy.adUnavailable);
        return;
      }

      if (!getTelegramApp()) {
        setActionError(copy.adTelegramOnly);
        return;
      }

      try {
        setBusyAction("task");
        setActionError(null);

        await monetagSdk();
        setAdReadyToCollect((prev) => ({ ...prev, [taskId]: true }));
        setActionError(copy.adCompletedCollect);
      } catch {
        setActionError(copy.adLoadError);
      } finally {
        setBusyAction(null);
      }

      return;
    }

    if (task.kind === "link_visit") {
      const rawUrl = String(task.link_url ?? "").trim();
      if (!rawUrl) {
        setActionError(copy.taskDestination);
        return;
      }

      const taskUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const tg = getTelegramApp();
      const isTelegramDeepLink = /^(https?:\/\/)?(t\.me|telegram\.me)\//i.test(taskUrl);

      if (isTelegramDeepLink && tg?.openTelegramLink) {
        tg.openTelegramLink(taskUrl);
      } else if (tg?.openLink) {
        tg.openLink(taskUrl, { try_instant_view: true });
      } else {
        window.open(taskUrl, "_blank", "noopener,noreferrer");
      }

      await claimTask(task.id);
      return;
    }

    if (task.claimable) {
      await claimTask(task.id);
      return;
    }

    if (task.kind === "invite_1" || task.kind === "weekly_invite") {
      setActiveTab("referrals");
      return;
    }

    setActiveTab("tap");
  };

  const localizeTask = (task: GameState["tasks"][number]) => {
    const target = Number(task.target_value ?? 1);
    const localeMap: Record<Locale, Record<string, { title: string; description: string }>> = {
      en: {
        taps_500: { title: `Do ${target} taps today`, description: `Tap ${target} times today.` },
        invite_1: { title: `Invite ${target} friend(s)`, description: `Invite at least ${target} friend(s) today.` },
        weekly_bmh: { title: "Weekly Mission: Earn BMH", description: `Earn ${target.toLocaleString("en-US")} BMH this week.` },
        weekly_invite: { title: "Weekly Mission: Invite friends", description: `Invite ${target} new friends this week.` },
      },
      pt: {
        taps_500: { title: `Faça ${target} taps hoje`, description: `Toque ${target} vezes hoje.` },
        invite_1: { title: `Convide ${target} amigo(s)`, description: `Convide pelo menos ${target} amigo(s) hoje.` },
        weekly_bmh: { title: "Missão semanal: Ganhe BMH", description: `Ganhe ${target.toLocaleString("pt-BR")} BMH nesta semana.` },
        weekly_invite: { title: "Missão semanal: Convide amigos", description: `Convide ${target} novos amigos nesta semana.` },
      },
      es: {
        taps_500: { title: `Haz ${target} taps hoy`, description: `Haz ${target} taps hoy.` },
        invite_1: { title: `Invita a ${target} amigo(s)`, description: `Invita al menos a ${target} amigo(s) hoy.` },
        weekly_bmh: { title: "Misión semanal: Gana BMH", description: `Gana ${target.toLocaleString("es-ES")} BMH esta semana.` },
        weekly_invite: { title: "Misión semanal: Invita amigos", description: `Invita a ${target} amigos nuevos esta semana.` },
      },
    };

    const resolved = localeMap[locale][task.kind];
    if (resolved) return resolved;

    return {
      title: task.title,
      description: task.description ?? (isAdTask(task) ? copy.tasksAutoRefresh : ""),
    };
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
      return <main className="flex min-h-screen items-center justify-center text-destructive">{error ?? copy.appLoadError}</main>;
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
        <h1 className="text-2xl font-bold">{copy.appTitle}</h1>
        <p className="text-sm text-muted-foreground">{copy.airdropPlaceholder || state.airdrop_placeholder}</p>
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
        <p className="mt-1 text-xs text-muted-foreground">{copy.energy} {state.user.energy}/{state.user.max_energy} · +1 {copy.inSeconds} {state.user.next_regen_in}s</p>
      </header>

      {activeTab === "tap" && (
        <section className="space-y-4">
          <Card className="relative overflow-hidden border-border/70 bg-card/85 p-6 text-center">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{copy.loadingAdHint}</p>
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
            <p className="mt-3 text-xs text-muted-foreground">{copy.calendarTitle}</p>
            <div className="mt-2 grid grid-cols-10 gap-1">
              {Array.from({ length: 30 }).map((_, index) => {
                const dayNo = index + 1;
                const reached = dayNo <= state.user.daily_streak;
                return (
                  <span key={dayNo} className={`rounded px-1 py-0.5 text-center text-[10px] ${reached ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>
                    {dayNo}
                  </span>
                );
              })}
            </div>
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
              <p className="mb-3 text-xs text-muted-foreground">{upgradeMeta[u.upgrade_type]?.description[locale] ?? ""}</p>
              <Button className="w-full" disabled={busyAction !== null} onClick={() => buyUpgrade(u.upgrade_type)}>
                {copy.upgradeBuy} ({u.next_cost.toLocaleString(numberLocale)} BMH)
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
                <h2 className="font-semibold">{copy.connectWalletTitle}</h2>
                <p className="text-xs text-muted-foreground">{copy.walletHintTonConnect}</p>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <WalletConnectButton
              connectLabel={copy.connectWallet}
              connectedLabel={copy.linkedWallet}
              disconnectLabel={copy.disconnectWallet}
              connectingLabel={copy.connectingWallet}
            />
            <div className="mt-2">
              <WalletStatusDisplay
                connected={Boolean(tonWallet)}
                statusConnectedLabel={copy.linkedWallet}
                statusDisconnectedLabel={copy.disconnected}
                addressLabel={copy.linkedWallet}
                address={tonRawAddress || undefined}
              />
            </div>
            {tonWallet && !isTonWalletLinked && (
              <Button className="mt-2 w-full" disabled={busyAction !== null} onClick={() => void connectWalletWithTonConnect()}>
                {copy.verifyAndLink}
              </Button>
            )}
            <Button
              className="mt-2 w-full"
              variant="secondary"
              disabled={busyAction !== null}
              onClick={() => {
                const tg = getTelegramApp();
                if (tg?.openTelegramLink) tg.openTelegramLink("https://t.me/wallet");
                else window.open("https://t.me/wallet", "_blank", "noopener,noreferrer");
              }}
            >
              {copy.openTelegramWallet}
            </Button>
            {tonWallet && !isTonWalletLinked && <p className="mt-2 text-xs text-muted-foreground">{copy.walletConnectedNotLinked}</p>}
            {state.user.wallet_address && <p className="mt-2 break-all text-xs text-muted-foreground">{copy.linkedWallet}: {state.user.wallet_address}</p>}
          </Card>
          {(state.active_passes ?? []).length > 0 && (
            <Card className="border-border/70 bg-card/85 p-4">
              <p className="mb-2 font-semibold">{copy.activePasses}</p>
              <div className="space-y-1 text-xs">
                {(state.active_passes ?? []).map((p) => (
                  <p key={`${p.pass_type}-${p.expires_at}`}>
                    {p.pass_type === "weekly" ? copy.weeklyPass : copy.monthlyPass} {copy.activeUntil} {new Date(p.expires_at).toLocaleString(numberLocale)}
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
              <p className="text-sm text-muted-foreground">{copy.durationDays}: {pass.duration_days} {copy.days}</p>
              <p className="mt-1 text-sm text-muted-foreground">{pass.benefits}</p>
              <Button className="mt-3 w-full" disabled={busyAction !== null} onClick={() => void createPassCheckout(pass.pass_type)}>
                {copy.buyNow}
              </Button>
            </Card>
          ))}
          {passCheckout && (
            <Card className="border-border/70 bg-card/85 p-4">
              <p className="font-semibold">{copy.checkoutStarted}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.paymentComment}: {passCheckout.payment_comment}</p>
              <input
                value={txHashInput}
                onChange={(e) => setTxHashInput(e.target.value)}
                className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder={copy.txHashPlaceholder}
              />
              <Button className="mt-2 w-full" disabled={busyAction !== null} onClick={() => void confirmPassCheckout()}>
                {copy.confirmPayment}
              </Button>
            </Card>
          )}
          {(state.monetization_passes ?? []).length === 0 && (
            <Card className="border-border/70 bg-card/85 p-4 text-sm text-muted-foreground">
              {copy.noPasses}
            </Card>
          )}
        </section>
      )}

      {activeTab === "referrals" && (
        <section className="space-y-3">
          <Card className="border-border/70 bg-card/85 p-4">
            <p className="text-sm text-muted-foreground">{copy.uniqueLink}</p>
            <p className="mt-1 break-all text-sm">{state.user.referral_link}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busyAction !== null} onClick={copyReferralLink}>{copy.copyLink}</Button>
              <Button disabled={busyAction !== null} onClick={shareReferralLink}>{copy.share}</Button>
            </div>
            <Button className="mt-2 w-full" variant="outline" disabled={busyAction !== null} onClick={() => setActiveTab("passes")}>
              {copy.goConnectWallet}
            </Button>
          </Card>
          <Card className="border-border/70 bg-card/85 p-4">
            <p className="mb-2 font-semibold">{copy.referredFriends} ({state.referrals.length})</p>
            <div className="space-y-2 text-sm">
              {state.referrals.map((r) => (
                <div key={r.telegram_id} className="flex items-center justify-between rounded-lg bg-secondary/70 px-3 py-2">
                  <span>{r.first_name ?? r.username ?? `#${r.telegram_id}`} · {new Date(r.created_at).toLocaleDateString(numberLocale)}</span>
                  <span className="text-primary">{copy.inviteBonus}</span>
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
              ["all_time", copy.allTime],
              ["weekly", copy.weekly],
              ["friends", copy.friends],
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
          {state.tasks.filter((task) => !isAdTask(task) || task.claimable || Boolean(adReadyToCollect[String(task.id)])).map((task) => (
            <Card key={task.id} className="border-border/70 bg-card/85 p-4">
              <h2 className="font-semibold">{localizeTask(task).title}</h2>
              <p className="text-sm text-muted-foreground">{localizeTask(task).description}</p>
              {task.kind === "link_visit" && task.link_url && (
                <p className="mt-1 break-all text-xs text-muted-foreground">{copy.taskDestination}: {task.link_url}</p>
              )}
              <div className="mt-3 flex items-center justify-between">
                 <span className="text-primary">+{task.reward_bmh.toLocaleString(numberLocale)} BMH</span>
                <Button disabled={task.completed || busyAction !== null} onClick={() => void handleTaskAction(task)}>
                  {task.completed
                    ? copy.completed
                    : isAdTask(task)
                      ? adReadyToCollect[String(task.id)]
                        ? copy.collect
                        : copy.watchAd
                      : task.kind === "link_visit"
                        ? copy.openLink
                        : task.claimable
                          ? copy.collect
                          : copy.doTask}
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
              {tabLabels[tab.key]}
            </button>
          );
        })}
      </nav>
    </main>
  );
};

export default Index;
