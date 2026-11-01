import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { titleSelectionSchema, type TitleProviderId, type TitleSettingsView } from "./title-contract";

export function defineTitleSettings(bb: Pick<BbPluginApi, "settings">) {
  return bb.settings.define({
    titleProvider: {
      type: "string", label: "Title provider", default: "",
      description: "Agent provider used for titles in every thread.",
      experimental_schema: z.string().max(200),
    },
    titleModel: {
      type: "string", label: "Title model", default: "",
      description: "Small model selected for title generation.",
      experimental_schema: z.string().max(200),
    },
  });
}
export type TitleSettingsHandle = ReturnType<typeof defineTitleSettings>;

export interface TitleConfigurationSdk {
  system: { config(): Promise<{ primaryHostId: string | null }> };
  providers: {
    list(args: { hostId: string }): Promise<readonly { id: string; displayName: string; available: boolean }[]>;
    models(args: { hostId: string; providerId: string }): Promise<{
      models: readonly { id: string; model: string }[];
      modelLoadError?: unknown;
    }>;
  };
  hosts: {
    providerCliStatus(args: { hostId: string }): Promise<Record<string, {
      installed: boolean;
      executablePath: string | null;
      versionUnsupported?: boolean;
    }>>;
  };
}

export interface ResolvedTitleConfiguration {
  providerId: TitleProviderId;
  model: string;
  hostId: string;
  executablePath: string;
  fingerprint: string;
}

const supportedProviders = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
];
const supportedIds = new Set(supportedProviders.map(provider => provider.id));
const configureReason = "Configure a title provider and model in the plugin settings.";

export function createTitleConfiguration(sdk: TitleConfigurationSdk, settings: TitleSettingsHandle) {
  let revision = 0;
  settings.onChange(() => { revision += 1; });

  async function inspect(): Promise<{ view: TitleSettingsView; resolved: ResolvedTitleConfiguration | null }> {
    const stored = await settings.get();
    const providerId = stored.titleProvider;
    const model = stored.titleModel;
    const selection = titleSelectionSchema.safeParse({ providerId, model });
    const configured = selection.success && providerId !== "";
    const view: TitleSettingsView = {
      providerId, model, hostId: null,
      providers: supportedProviders.map(provider => ({
        ...provider, supported: true, available: false, reason: "No primary machine is connected.",
      })),
      state: configured ? "unavailable" : "unconfigured",
      reason: configured ? "No primary machine is connected." : configureReason,
    };
    if (!selection.success) {
      view.state = "unavailable";
      view.reason = "The configured title provider or model is invalid.";
    }

    let primaryHostId: string | null;
    try { primaryHostId = (await sdk.system.config()).primaryHostId; }
    catch {
      if (configured) view.reason = "The primary machine could not be checked.";
      return { view, resolved: null };
    }
    view.hostId = primaryHostId;
    if (!primaryHostId) return { view, resolved: null };

    try {
      const [providers, cliStatuses] = await Promise.all([
        sdk.providers.list({ hostId: primaryHostId }),
        sdk.hosts.providerCliStatus({ hostId: primaryHostId }),
      ]);
      const choices = new Map(supportedProviders.map(provider => [provider.id, provider.label]));
      for (const provider of providers) choices.set(provider.id, provider.displayName);
      view.providers = [...choices].map(([id, label]) => {
        const supported = supportedIds.has(id);
        const provider = providers.find(entry => entry.id === id);
        const cli = cliStatuses[id];
        let reason: string | null = null;
        if (!supported) reason = "This provider is not supported for title generation.";
        else if (!provider?.available) reason = "This provider is disabled or unavailable on the primary machine.";
        else if (!cli?.installed || !cli.executablePath) reason = "The provider CLI is not installed on the primary machine.";
        else if (cli.versionUnsupported) reason = "The provider CLI version is not supported.";
        return { id, label, supported, available: reason === null, reason };
      });
      if (!configured) return { view, resolved: null };
      const selected = view.providers.find(provider => provider.id === providerId);
      if (!selected?.available) {
        view.reason = selected?.reason ?? "The configured provider is unavailable.";
        return { view, resolved: null };
      }
      const catalog = await sdk.providers.models({ hostId: primaryHostId, providerId });
      if (catalog.modelLoadError || !catalog.models.some(entry => entry.model === model || entry.id === model)) {
        view.reason = "The selected model is unavailable in this provider's model catalog.";
        return { view, resolved: null };
      }
      const executablePath = cliStatuses[providerId]?.executablePath;
      if (!executablePath) return { view, resolved: null };
      const provider = selection.data.providerId;
      if (provider === "") return { view, resolved: null };
      view.state = "configured";
      view.reason = null;
      return {
        view,
        resolved: {
          providerId: provider, model, hostId: primaryHostId, executablePath,
          fingerprint: JSON.stringify([revision, provider, model, primaryHostId, executablePath]),
        },
      };
    } catch {
      if (configured) view.reason = "The selected provider or model could not be checked on the primary machine.";
      return { view, resolved: null };
    }
  }

  return {
    async read(): Promise<TitleSettingsView> { return (await inspect()).view; },
    async save(input: { providerId: string; model: string }): Promise<TitleSettingsView> {
      const selection = titleSelectionSchema.parse(input);
      await settings.experimental_set({ titleProvider: selection.providerId, titleModel: selection.model });
      return (await inspect()).view;
    },
    async resolve(): Promise<ResolvedTitleConfiguration> {
      const { view, resolved } = await inspect();
      if (!resolved) throw new Error(view.reason ?? "The title configuration is unavailable.");
      return resolved;
    },
  };
}
export type TitleConfiguration = ReturnType<typeof createTitleConfiguration>;
