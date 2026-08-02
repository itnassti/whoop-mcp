import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/lib/api";
import { ConnectCard } from "@/components/ConnectCard";
import { TokensCard } from "@/components/TokensCard";
import { ConnectionGuide } from "@/components/ConnectionGuide";
import { DangerZone } from "@/components/DangerZone";
import { ThemeToggle } from "@/components/ThemeToggle";

function App() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .session()
      .then((res) => setConnected(res.connected))
      .catch(() => setConnected(false));
  }, []);

  const disconnect = () => setConnected(false);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-heading text-base font-medium">WHOOP MCP</span>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        {connected === null ? (
          <div className="flex justify-center py-16">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" role="status" aria-label="Loading" />
          </div>
        ) : connected ? (
          <>
            <TokensCard onUnauthorized={disconnect} />
            <ConnectionGuide />
            <DangerZone onDeleted={disconnect} />
          </>
        ) : (
          <ConnectCard />
        )}
      </main>
    </div>
  );
}

export default App;
