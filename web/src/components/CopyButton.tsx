import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  async function handleCopy() {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      // ignore
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {label}
    </Button>
  );
}
