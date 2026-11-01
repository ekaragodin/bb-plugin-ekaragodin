import { expect, it } from "vitest";
import { createTitleConfiguration, type TitleConfigurationSdk, type TitleSettingsHandle } from "./title-configuration";

function fixture(initial = { titleProvider: "", titleModel: "" }) {
  let values = { ...initial };
  const listeners: ((next: typeof values, previous: typeof values) => void)[] = [];
  const settings: TitleSettingsHandle = {
    get: async () => ({ ...values }),
    experimental_set: async (next) => {
      const previous = values;
      values = { titleProvider: next.titleProvider ?? "", titleModel: next.titleModel ?? "" };
      for (const listener of listeners) listener(values, previous);
      return { ...values };
    },
    onChange: listener => { listeners.push(listener); },
  };
  const hostIds: string[] = [];
  const sdk: TitleConfigurationSdk = {
    system: { config: async () => ({ primaryHostId: "primary" }) },
    providers: {
      list: async ({ hostId }) => {
        hostIds.push(hostId);
        return [
          { id: "codex", displayName: "Codex", available: true },
          { id: "claude-code", displayName: "Claude Code", available: true },
          { id: "pi", displayName: "Pi", available: true },
        ];
      },
      models: async ({ hostId, providerId }) => {
        hostIds.push(hostId);
        return { models: [{ id: providerId === "codex" ? "picker-small" : "haiku", model: providerId === "codex" ? "gpt-small" : "haiku" }], modelLoadError: null };
      },
    },
    hosts: { providerCliStatus: async ({ hostId }) => {
      hostIds.push(hostId);
      return {
        codex: { installed: true, executablePath: "/usr/bin/codex", versionUnsupported: false },
        "claude-code": { installed: true, executablePath: "/usr/bin/claude", versionUnsupported: false },
      };
    } },
  };
  return { settings, sdk, hostIds };
}

it("persists the explicit global pair across service recreation", async () => {
  const f = fixture();
  await createTitleConfiguration(f.sdk, f.settings).save({ providerId: "claude-code", model: "haiku" });
  const next = createTitleConfiguration(f.sdk, f.settings);
  expect(await next.resolve()).toMatchObject({ providerId: "claude-code", model: "haiku", hostId: "primary", executablePath: "/usr/bin/claude" });
  expect(f.hostIds.every(id => id === "primary")).toBe(true);
});

it("keeps empty settings unconfigured and offers unsupported providers without enabling them", async () => {
  const f = fixture();
  const config = createTitleConfiguration(f.sdk, f.settings);
  expect(await config.read()).toMatchObject({ state: "unconfigured", providerId: "", model: "", providers: expect.arrayContaining([expect.objectContaining({ id: "pi", supported: false, available: false })]) });
  await expect(config.resolve()).rejects.toThrow(/configure/i);
  await expect(config.save({ providerId: "pi", model: "small" })).rejects.toThrow();
});

it("uses the selected catalog model and never substitutes a default", async () => {
  const f = fixture({ titleProvider: "codex", titleModel: "gpt-small" });
  const config = createTitleConfiguration(f.sdk, f.settings);
  expect(await config.resolve()).toMatchObject({ model: "gpt-small" });
  await config.save({ providerId: "codex", model: "not-in-catalog" });
  expect(await config.read()).toMatchObject({ state: "unavailable", model: "not-in-catalog" });
  await expect(config.resolve()).rejects.toThrow(/model/i);
});

it("rejects missing machine, CLI, and disabled provider without launching anything", async () => {
  const f = fixture({ titleProvider: "codex", titleModel: "gpt-small" });
  f.sdk.system.config = async () => ({ primaryHostId: null });
  expect(await createTitleConfiguration(f.sdk, f.settings).read()).toMatchObject({ state: "unavailable", hostId: null });
  f.sdk.system.config = async () => ({ primaryHostId: "primary" });
  f.sdk.hosts.providerCliStatus = async () => ({ codex: { installed: false, executablePath: null } });
  await expect(createTitleConfiguration(f.sdk, f.settings).resolve()).rejects.toThrow(/CLI/i);
  f.sdk.providers.list = async () => [];
  await expect(createTitleConfiguration(f.sdk, f.settings).resolve()).rejects.toThrow(/provider/i);
});

it("changes the fingerprint when settings change, even when changed back", async () => {
  const f = fixture({ titleProvider: "codex", titleModel: "gpt-small" });
  const config = createTitleConfiguration(f.sdk, f.settings);
  const first = (await config.resolve()).fingerprint;
  await config.save({ providerId: "claude-code", model: "haiku" });
  await config.save({ providerId: "codex", model: "gpt-small" });
  expect((await config.resolve()).fingerprint).not.toBe(first);
  await config.save({ providerId: "", model: "" });
  expect(await config.read()).toMatchObject({ state: "unconfigured" });
});
