import { afterEach, expect, it, vi } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { completeTitle } from "./title-provider";
import host from "./host";

vi.mock("./title-provider", () => ({ completeTitle: vi.fn(async () => ({ title: "#123 Fix switching" })) }));
afterEach(() => vi.clearAllMocks());

it("routes title calls through the existing host entry with request and lifecycle cancellation", async () => {
  const harness = experimental_createHostEntryHarness(host);
  try {
    const input = { providerId: "codex", model: "gpt-6-luna", executablePath: "/usr/bin/codex", prompt: "Pick a title" } satisfies Parameters<typeof completeTitle>[0];
    expect(await harness.experimental_call("titleComplete", input)).toEqual({ title: "#123 Fix switching" });
    expect(completeTitle).toHaveBeenCalledWith(input, expect.any(AbortSignal), expect.any(AbortSignal));
  } finally { await harness.experimental_dispose(); }
});
