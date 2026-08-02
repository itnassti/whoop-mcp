import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ConnectionGuide } from "./ConnectionGuide";

describe("ConnectionGuide", () => {
  it("renders snippets with the real token when provided", () => {
    const { container } = render(<ConnectionGuide token="whoopmcp_pat_ABC123" />);
    const text = container.textContent ?? "";
    expect(text).toContain("whoopmcp_pat_ABC123");
    expect(text).toContain("claude mcp add");
    expect(text).toContain('"mcpServers"');
    expect(text).toContain("/mcp");
  });

  it("renders a placeholder token and hint when no token is provided", () => {
    const { container } = render(<ConnectionGuide />);
    const text = container.textContent ?? "";
    expect(text).toContain("YOUR_TOKEN");
    expect(text).toContain("Create a token below");
  });
});
