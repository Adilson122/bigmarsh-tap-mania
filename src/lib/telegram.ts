export type TelegramThemeParams = Record<string, string | undefined>;

export type TelegramMiniUser = {
  id: number;
  username?: string;
  first_name?: string;
  photo_url?: string;
};

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: {
    user?: TelegramMiniUser;
    start_param?: string;
  };
  themeParams?: TelegramThemeParams;
  ready: () => void;
  expand: () => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  };
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
};

export const getTelegramApp = (): TelegramWebApp | null => {
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
};

export const getTelegramUser = () => {
  const tg = getTelegramApp();
  return tg?.initDataUnsafe?.user;
};

export const getStartParam = () => {
  const tg = getTelegramApp();
  return tg?.initDataUnsafe?.start_param;
};

export const setupTelegram = () => {
  const tg = getTelegramApp();
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.HapticFeedback?.impactOccurred("medium");

  const params = tg.themeParams ?? {};
  if (params.bg_color) document.documentElement.style.setProperty("--tg-bg", params.bg_color);
  if (params.button_color) document.documentElement.style.setProperty("--tg-button", params.button_color);
  if (params.button_text_color) document.documentElement.style.setProperty("--tg-button-text", params.button_text_color);
  if (params.hint_color) document.documentElement.style.setProperty("--tg-hint", params.hint_color);
};