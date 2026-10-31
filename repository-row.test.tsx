// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { RepositoryRow } from "./repository-row";

const slots: ReturnType<typeof renderSlot>[] = [];
afterEach(() => { for (const slot of slots.splice(0)) slot.lifecycle.unmount(); });

it("reads the environment repository and refreshes after reconnect", async () => {
  let available = false;
  const slot = renderSlot({ component: RepositoryRow }, {
    threadId: "thread", projectId: "project", environment: { id: "checkout" },
  }, {
    rpc: {
      repository: () => {
        if (!available) throw new Error("Git unavailable");
        return { href: "https://github.com/owner/repo" };
      },
    },
  });
  slots.push(slot);
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  expect(slot.queryByText("owner/repo")).toBeNull();
  expect(slot.inspection.rpcCalls).toHaveLength(1);
  available = true;
  await slot.behavior.setRealtimeConnectionState("connected");
  const link = await slot.findByText("owner/repo");
  expect(link.getAttribute("href")).toBe("https://github.com/owner/repo");
  expect(slot.inspection.rpcCalls).toHaveLength(2);
  expect(slot.inspection.rpcCalls.every((call) =>
    JSON.stringify(call.input) === JSON.stringify({ environmentId: "checkout" }))).toBe(true);
});

it("does not request a repository without an environment", () => {
  const slot = renderSlot({ component: RepositoryRow }, {
    threadId: "thread", projectId: "project", environment: null,
  });
  slots.push(slot);
  expect(slot.queryByText("Repository")).toBeNull();
  expect(slot.inspection.rpcCalls).toEqual([]);
});
