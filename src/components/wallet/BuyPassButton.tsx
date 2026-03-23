import { useState } from "react";
import { useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type BuyPassButtonProps = {
  amountNano: number;
  recipient: string;
  comment: string;
  label: string;
  connectingLabel: string;
  processingLabel: string;
  successLabel: string;
  disabled?: boolean;
  onPreparePayment: () => Promise<{ purchaseId: string }>;
  onConfirmPayment: (params: { purchaseId: string; txRef: string | null }) => Promise<void>;
  onError?: (error: Error) => void;
};

const createCommentPayload = (comment: string) => {
  const textBytes = new TextEncoder().encode(comment);
  const bytes = new Uint8Array(4 + textBytes.length);
  bytes.set(textBytes, 4);

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

export const BuyPassButton = ({
  amountNano,
  recipient,
  comment,
  label,
  connectingLabel,
  processingLabel,
  successLabel,
  disabled,
  onPreparePayment,
  onConfirmPayment,
  onError,
}: BuyPassButtonProps) => {
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const [phase, setPhase] = useState<"idle" | "connecting" | "processing" | "success">("idle");

  const onBuy = async () => {
    if (disabled || phase === "connecting" || phase === "processing") return;

    if (!tonWallet) {
      try {
        setPhase("connecting");
        await tonConnectUI.openModal();
      } finally {
        setPhase("idle");
      }
      return;
    }

    try {
      setPhase("processing");
      const checkout = await onPreparePayment();
      const payload = createCommentPayload(comment);

      const txResult = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [
          {
            address: recipient,
            amount: String(amountNano),
            payload,
          },
        ],
      });

      const txRef = typeof txResult?.boc === "string" ? txResult.boc : null;
      await onConfirmPayment({ purchaseId: checkout.purchaseId, txRef });

      setPhase("success");
      window.setTimeout(() => setPhase("idle"), 1800);
    } catch (error) {
      setPhase("idle");
      onError?.(error instanceof Error ? error : new Error("payment_failed"));
    }
  };

  return (
    <Button type="button" className="mt-3 w-full" onClick={() => void onBuy()} disabled={Boolean(disabled) || phase === "processing"}>
      {phase === "success" ? <CheckCircle2 className="h-4 w-4" /> : phase !== "idle" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {phase === "connecting" ? connectingLabel : phase === "processing" ? processingLabel : phase === "success" ? successLabel : label}
    </Button>
  );
};
