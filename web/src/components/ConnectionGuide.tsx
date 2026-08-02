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

  const tokenStepText = token ? "Your new token is filled in below." : "Create a token below and copy it.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an AI assistant</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Use the MCP server URL below. Pick the path that matches your client.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm select-text">
              {mcpUrl}
            </code>
            <CopyButton text={mcpUrl} label="Copy URL" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Claude Desktop · Claude.ai · ChatGPT (OAuth — no token)</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              Open your assistant's settings and go to Connectors. (Custom connectors require a paid plan; on
              Team/Enterprise an admin may need to enable custom connectors first.)
            </li>
            <li>Click "Add custom connector".</li>
            <li>
              Give it a name (e.g. "WHOOP") and paste the MCP server URL above as the remote server URL, then save.
            </li>
            <li>Click "Connect" and log in with WHOOP in the browser window that opens.</li>
            <li>Enable the WHOOP connector in your chat.</li>
          </ol>
          <p className="text-sm text-muted-foreground">
            No token needed — the connector runs the WHOOP login for you.
          </p>
          <div>
            <CopyButton text={mcpUrl} label="Copy URL" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Claude Code (CLI)</h3>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>{tokenStepText}</li>
            <li>
              Run this command (your token is already included):
              <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs">
                <code className="font-mono select-text">{claudeCodeCommand}</code>
              </pre>
              <div className="mt-1">
                <CopyButton text={claudeCodeCommand} label="Copy command" />
              </div>
            </li>
            <li>Restart Claude Code — the WHOOP tools appear as mcp__whoop__*.</li>
          </ol>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Cursor · Cline (mcp.json)</h3>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>{tokenStepText}</li>
            <li>
              Add this to your mcp.json (Cursor: ~/.cursor/mcp.json; Cline: its MCP settings):
              <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs">
                <code className="font-mono select-text whitespace-pre">{mcpJson}</code>
              </pre>
              <div className="mt-1">
                <CopyButton text={mcpJson} label="Copy config" />
              </div>
            </li>
            <li>Reload the client — the WHOOP tools become available.</li>
          </ol>
        </div>

        <p className="text-sm text-muted-foreground">
          Test it: ask your assistant "Show me my WHOOP recovery today."
        </p>
      </CardContent>
    </Card>
  );
}
