import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { connectUrl } from "@/lib/api";

export function ConnectCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect your WHOOP account</CardTitle>
        <CardDescription>
          Link your WHOOP account to create personal access tokens for the MCP server.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          You'll be redirected to WHOOP to authorize access, then brought back here.
        </p>
      </CardContent>
      <CardFooter>
        <a href={connectUrl} className={buttonVariants({ size: "lg" })}>
          Connect WHOOP
        </a>
      </CardFooter>
    </Card>
  );
}
