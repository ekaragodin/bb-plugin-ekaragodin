// @vitest-environment jsdom
import { fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { titleContract, type TitleSettingsView } from "./title-contract";
import { TitleSettings, TitleRefreshFeedback } from "./title-settings";
import { createTitleActionController } from "./title-action";

const slots: ReturnType<typeof renderSlot>[] = [];
const unexpectedRpc = () => { throw new Error("Unexpected RPC call"); };
afterEach(() => { for (const slot of slots.splice(0)) slot.lifecycle.unmount(); });
const settings: TitleSettingsView = {
  providerId: "codex", model: "small", hostId: "primary",
  state: "configured", reason: null,
  providers: [
    { id: "codex", label: "Codex", supported: true, available: true, reason: null },
    { id: "claude-code", label: "Claude Code", supported: true, available: true, reason: null },
    { id: "pi", label: "Pi", supported: false, available: false, reason: "This provider is not supported for title generation." },
  ],
};
function catalog(models: string[]): Awaited<ReturnType<PluginBrowserBbSdk["providers"]["models"]>> {
  return { modelLoadError: null, permissionCeiling: "full", providers: [], selectedOnlyModels: [], models: models.map(id => ({
    id, model: id, displayName: id, description: "", defaultReasoningEffort: "low", supportedReasoningEfforts: [], reasoningDiscovery: "known", isDefault: false,
  })) };
}

it("loads global settings and explicitly saves a model on the primary machine", async () => {
  const models = vi.fn(async (_input: Parameters<PluginBrowserBbSdk["providers"]["models"]>[0] = undefined) => catalog(["small", "haiku"]));
  const save = vi.fn(async (selection: { providerId: string; model: string }) => ({ ...settings, ...selection }));
  const slot = renderSlot<object, typeof titleContract>({ component: TitleSettings }, {}, { experimental_rpcContract: titleContract, context: { threadId: "a-codex-thread" }, rpc: {
    titleSettings: () => settings, saveTitleSettings: save, refreshTitle: unexpectedRpc,
  }, sdk: { providers: { models } } });
  slots.push(slot);
  const provider = await slot.findByLabelText("Title provider");
  await waitFor(() => expect((slot.getByLabelText("Title model") as HTMLSelectElement).value).toBe("small"));
  expect(slot.getByRole("option", { name: /Pi.*not supported/u }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(provider, { target: { value: "claude-code" } });
  await waitFor(() => expect(slot.getByRole("button", { name: "Save title settings" }).hasAttribute("disabled")).toBe(true));
  await waitFor(() => expect(slot.getByRole("option", { name: "haiku" })).toBeTruthy());
  fireEvent.change(slot.getByLabelText("Title model"), { target: { value: "haiku" } });
  fireEvent.click(slot.getByRole("button", { name: "Save title settings" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ providerId: "claude-code", model: "haiku" }));
  expect(models.mock.calls.every(call => JSON.stringify(call[0]).includes('"hostId":"primary"'))).toBe(true);
});

it("retains the saved model when its catalog is empty and shows load failures", async () => {
  const slot = renderSlot<object, typeof titleContract>({ component: TitleSettings }, {}, { experimental_rpcContract: titleContract, rpc: { titleSettings: () => settings, saveTitleSettings: unexpectedRpc, refreshTitle: unexpectedRpc }, sdk: {
    providers: { models: async () => catalog([]) },
  } });
  slots.push(slot);
  await slot.findByRole("option", { name: "small (unavailable)" });
  expect((slot.getByLabelText("Title model") as HTMLSelectElement).value).toBe("small");
  expect(slot.getByRole("button", { name: "Save title settings" }).hasAttribute("disabled")).toBe(true);
  await slot.findByText(/No models available/u);
});

it("ignores late model responses after a provider switch and reports a save error", async () => {
  let finishOld!: (value: ReturnType<typeof catalog>) => void;
  const models = vi.fn((input: Parameters<PluginBrowserBbSdk["providers"]["models"]>[0] = undefined) => input?.providerId === "codex"
    ? new Promise<ReturnType<typeof catalog>>(resolve => { finishOld = resolve; })
    : Promise.resolve(catalog(["haiku"])));
  const slot = renderSlot<object, typeof titleContract>({ component: TitleSettings }, {}, { experimental_rpcContract: titleContract, rpc: {
    titleSettings: () => settings, saveTitleSettings: () => { throw new Error("network"); }, refreshTitle: unexpectedRpc,
  }, sdk: { providers: { models } } });
  slots.push(slot);
  await waitFor(() => expect(models).toHaveBeenCalledWith({ hostId: "primary", providerId: "codex" }));
  fireEvent.change(slot.getByLabelText("Title provider"), { target: { value: "claude-code" } });
  await slot.findByRole("option", { name: "haiku" });
  await act(async () => finishOld(catalog(["late-old-model"])));
  expect(slot.queryByRole("option", { name: "late-old-model" })).toBeNull();
  fireEvent.change(slot.getByLabelText("Title model"), { target: { value: "haiku" } });
  fireEvent.click(slot.getByRole("button", { name: "Save title settings" }));
  await slot.findByRole("alert");
  expect(slot.getByRole("alert").textContent).toContain("Could not save title settings");
});

it("renders action progress and errors outside the conversation", async () => {
  const controller = createTitleActionController();
  const slot = renderSlot({ component: () => <TitleRefreshFeedback controller={controller} /> }, {});
  slots.push(slot);
  await act(async () => controller.action("thread", async () => ({ status: "failed", reason: "Provider is unavailable." })).run({ requestRename() {} }));
  expect(slot.getByRole("alert").textContent).toContain("Provider is unavailable.");
  fireEvent.click(slot.getByRole("button", { name: "Dismiss title notification" }));
  expect(slot.queryByRole("alert")).toBeNull();
  expect(slot.inspection.sdkCalls).toEqual([]);
});

it("registers the refresh action and title settings with BB", async () => {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.threadActions.some(action => action.id === "refresh-thread-title")).toBe(true);
  expect(app.settingsSections.some(section => section.id === "thread-title-generation")).toBe(true);
  expect(app.appOverlays.some(overlay => overlay.id === "thread-title-feedback")).toBe(true);
});

it("clears the shared provider and model only after an explicit save", async () => {
  const save = vi.fn(async () => ({ ...settings, providerId: "", model: "", state: "unconfigured" as const, reason: "Choose a model." }));
  const slot = renderSlot<object, typeof titleContract>({ component: TitleSettings }, {}, {
    experimental_rpcContract: titleContract,
    rpc: { titleSettings: () => settings, saveTitleSettings: save, refreshTitle: unexpectedRpc },
    sdk: { providers: { models: async () => catalog(["small"]) } },
  });
  slots.push(slot);
  fireEvent.change(await slot.findByLabelText("Title provider"), { target: { value: "" } });
  const button = slot.getByRole("button", { name: "Save title settings" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(save).toHaveBeenCalledWith({ providerId: "", model: "" }));
  await slot.findByText("Title settings saved.");
});

it("refreshes shared settings without replacing an unsaved selection", async () => {
  let current = settings;
  const read = vi.fn(() => current);
  const slot = renderSlot<object, typeof titleContract>({ component: TitleSettings }, {}, {
    experimental_rpcContract: titleContract,
    rpc: { titleSettings: read, saveTitleSettings: unexpectedRpc, refreshTitle: unexpectedRpc },
    sdk: { providers: { models: async () => catalog(["small", "haiku"]) } },
  });
  slots.push(slot);
  await waitFor(() => expect((slot.getByLabelText("Title model") as HTMLSelectElement).value).toBe("small"));
  fireEvent.change(slot.getByLabelText("Title model"), { target: { value: "haiku" } });
  current = { ...settings, model: "another-saved-model" };
  fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((slot.getByLabelText("Title model") as HTMLSelectElement).value).toBe("haiku"));
});
