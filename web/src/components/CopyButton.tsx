import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  async function handleCopy() {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {label}
    </Button>
  );
}
