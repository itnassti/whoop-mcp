import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

beforeEach(() => { vi.restoreAllMocks(); });

it("shows Connect WHOOP when not connected", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ connected: false }), { status: 200 }));
  render(<App />);
  await waitFor(() => expect(screen.getByText(/connect whoop/i)).toBeInTheDocument());
});

it("shows the tokens card when connected", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    String(url).endsWith("/session")
      ? new Response(JSON.stringify({ connected: true }), { status: 200 })
      : new Response(JSON.stringify({ tokens: [] }), { status: 200 }));
  render(<App />);
  await waitFor(() => expect(screen.getByText(/personal access tokens/i)).toBeInTheDocument());
});

it("returns to the Connect state when a session-authenticated call gets a 401", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    String(url).endsWith("/session")
      ? new Response(JSON.stringify({ connected: true }), { status: 200 })
      : new Response(JSON.stringify({ error: "not connected" }), { status: 401 }));
  render(<App />);
  await waitFor(() => expect(screen.getByText(/connect whoop/i)).toBeInTheDocument());
});
