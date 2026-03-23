import { Badge } from "@/components/ui/badge";

type WalletStatusDisplayProps = {
  connected: boolean;
  statusConnectedLabel: string;
  statusDisconnectedLabel: string;
  addressLabel: string;
  address?: string;
  paymentLabel?: string;
  paymentPaidLabel?: string;
  paymentPendingLabel?: string;
  paid?: boolean;
};

const shortenAddress = (address: string) => {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
};

export const WalletStatusDisplay = ({
  connected,
  statusConnectedLabel,
  statusDisconnectedLabel,
  addressLabel,
  address,
  paymentLabel,
  paymentPaidLabel,
  paymentPendingLabel,
  paid,
}: WalletStatusDisplayProps) => {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Status</p>
        <Badge variant={connected ? "default" : "secondary"}>{connected ? statusConnectedLabel : statusDisconnectedLabel}</Badge>
      </div>
      {paymentLabel && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{paymentLabel}</p>
          <Badge variant={paid ? "default" : "secondary"}>{paid ? paymentPaidLabel : paymentPendingLabel}</Badge>
        </div>
      )}
      {connected && address && (
        <p className="mt-2 break-all text-xs text-foreground">
          {addressLabel}: <span className="font-medium">{shortenAddress(address)}</span>
        </p>
      )}
    </div>
  );
};
