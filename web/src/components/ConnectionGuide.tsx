import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/CopyButton";

export function ConnectionGuide({ token }: { token?: string }) {
  const tok = token ?? "YOUR_TOKEN";
  const mcpUrl = `${window.location.origin}/mcp`;

  const claudeCodeCommand = `claude mcp add --transport http whoop ${mcpUrl} --header "Authorization: Bearer ${tok}"`;

  const mcpJson = `{
  "mcpServers": {
    "whoop": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${tok}" }
    }
  }
}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an AI assistant</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm select-text">
            {mcpUrl}
          </code>
          <CopyButton text={mcpUrl} />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Claude Desktop · Claude.ai · ChatGPT (OAuth — no token)</h3>
          <p className="text-sm text-muted-foreground">
            Add a custom connector with the MCP URL above and click Connect — you'll log in with WHOOP; no token
            needed.
          </p>
          <div>
            <CopyButton text={mcpUrl} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Claude Code (CLI)</h3>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs">
            <code className="font-mono select-text">{claudeCodeCommand}</code>
          </pre>
          <div>
            <CopyButton text={claudeCodeCommand} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Cursor · Cline (mcp.json)</h3>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs">
            <code className="font-mono select-text whitespace-pre">{mcpJson}</code>
          </pre>
          <div>
            <CopyButton text={mcpJson} />
          </div>
        </div>

        {!token ? (
          <p className="text-sm text-muted-foreground">
            Create a token below — right after creating it you'll get these snippets with your token already filled
            in.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
