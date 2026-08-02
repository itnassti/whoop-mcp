import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyIcon, Loader2Icon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { api, isUnauthorized, type TokenSummary } from "@/lib/api";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

interface TokenRowProps {
  token: TokenSummary;
  onRevoke: (id: string) => Promise<void>;
}

function TokenRow({ token, onRevoke }: TokenRowProps) {
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function handleConfirm() {
    setRevoking(true);
    try {
      await onRevoke(token.id);
      setOpen(false);
    } catch {
      // error already reported by onRevoke; keep the dialog open
    } finally {
      setRevoking(false);
    }
  }

  return (
    <TableRow>
      <TableCell>{token.label ?? <span className="text-muted-foreground">Unlabeled</span>}</TableCell>
      <TableCell>{formatDate(token.createdAt)}</TableCell>
      <TableCell>{token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never"}</TableCell>
      <TableCell>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
            Revoke
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke this token?</AlertDialogTitle>
              <AlertDialogDescription>
                Any application using this token will immediately lose access. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={revoking}>
                Revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export function TokensCard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function fetchTokens() {
    try {
      const { tokens: fetched } = await api.listTokens();
      setTokens(fetched);
    } catch (err) {
      if (isUnauthorized(err)) onUnauthorized();
      else toast.error(errorMessage(err));
    }
  }

  useEffect(() => {
    fetchTokens();
  }, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const { token } = await api.createToken();
      setNewToken(token);
    } catch (err) {
      if (isUnauthorized(err)) onUnauthorized();
      else toast.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.revokeToken(id);
      toast.success("Token revoked");
      await fetchTokens();
    } catch (err) {
      if (isUnauthorized(err)) {
        onUnauthorized();
        return;
      }
      toast.error(errorMessage(err));
      throw err;
    }
  }

  async function handleCopy() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Personal access tokens</CardTitle>
          <CardDescription>Use a token to authenticate MCP clients as your WHOOP account.</CardDescription>
          <CardAction>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2Icon className="animate-spin" /> : null}
              Create token
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {tokens === null ? (
            <div className="flex justify-center py-8">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" role="status" aria-label="Loading tokens" />
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TokenRow key={token.id} token={token} onRevoke={handleRevoke} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={newToken !== null}
        onOpenChange={(open) => {
          if (!open) {
            setNewToken(null);
            fetchTokens();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token created</DialogTitle>
            <DialogDescription>
              Copy this token now — for security it won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm">
              {newToken}
            </code>
            <Button variant="outline" size="icon" aria-label="Copy token" onClick={handleCopy}>
              <CopyIcon />
            </Button>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
