/// <reference types="vite/client" />

declare global {
  interface Window {
    Telegram?: {
      WebApp?: import("@/lib/telegram").TelegramWebApp;
    };
  }
}

export {};
