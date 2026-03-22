import { useEffect, useState } from "react";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { Loader2, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

type WalletConnectButtonProps = {
  connectLabel: string;
  connectedLabel: string;
  disconnectLabel: string;
  connectingLabel: string;
};

export const WalletConnectButton = ({
  connectLabel,
  connectedLabel,
  disconnectLabel,
  connectingLabel,
}: WalletConnectButtonProps) => {
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (tonWallet) {
      setIsConnecting(false);
      return;
    }

    if (!isConnecting) return;

    const timeoutId = window.setTimeout(() => {
      setIsConnecting(false);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [tonWallet, isConnecting]);

  const onConnect = async () => {
    setIsConnecting(true);
    await tonConnectUI.openModal();
  };

  const onDisconnect = async () => {
    await tonConnectUI.disconnect();
    setIsConnecting(false);
  };

  if (tonWallet) {
    return (
      <Button type="button" variant="secondary" className="w-full" onClick={() => void onDisconnect()}>
        <LogOut className="h-4 w-4" />
        {disconnectLabel}
      </Button>
    );
  }

  return (
    <Button type="button" className="w-full" onClick={() => void onConnect()} disabled={isConnecting}>
      {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
      {isConnecting ? connectingLabel : connectLabel}
      <span className="sr-only">{connectedLabel}</span>
    </Button>
  );
};
