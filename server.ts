import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { repositoryContract, repositoryHostContract } from "./repository-contract";
import { titleContract, titleHostContract } from "./title-contract";
import { createTitleConfiguration, createTitleSettings } from "./title-configuration";
import { readTitleContext } from "./title-context";
import { createTitleRefresh } from "./title-refresh";

export default function plugin(bb: BbPluginApi) {
  const controller = new AbortController();
  bb.onDispose(() => controller.abort());
  const configuration = createTitleConfiguration(bb.sdk, createTitleSettings(bb));
  const titleHost = bb.hosts.experimental_client({ contract: titleHostContract });
  const titles = createTitleRefresh({
    configuration: () => configuration.resolve(),
    context: (threadId, signal) => readTitleContext(bb.sdk, threadId, signal),
    complete: (selected, prompt, signal) => titleHost.call("titleComplete", {
      providerId: selected.providerId, model: selected.model,
      executablePath: selected.executablePath, prompt,
    }, { hostId: selected.hostId, signal, timeoutMs: 65_000 }),
    update: (threadId, title, signal) => {
      signal.throwIfAborted();
      return bb.sdk.threads.update({ threadId, title });
    },
    events: async (threadId, afterSeq, signal) => {
      const rows = await bb.sdk.threads.events.list({
        threadId, afterSeq: String(afterSeq), limit: "100", order: "asc",
        types: ["turn/completed"], signal,
      });
      return rows.flatMap(row => row.type === "turn/completed" && row.scope.kind === "turn"
        ? [{ seq: row.seq, createdAt: row.createdAt, turnId: row.scope.turnId, status: row.data.status }]
        : []);
    },
    kv: bb.storage.kv,
    signal: controller.signal,
  });
  bb.events.on("experimental_thread.events", ({ thread }) => titles.onEvents(thread.id));
  bb.rpc.register(titleContract, {
    titleSettings: () => configuration.read(),
    saveTitleSettings: input => configuration.save(input),
    refreshTitle: ({ threadId }, context) => titles.refresh(threadId, context.experimental_signal),
  }, {
    experimental_discoverable: true,
    experimental_description: "Read or configure the title model; refresh a thread title using that model.",
  });
  const host = bb.hosts.experimental_client({ contract: repositoryHostContract });
  bb.rpc.register(repositoryContract, {
    async repository({ environmentId }) {
      const environment = await bb.sdk.environments.get({ environmentId });
      if (!environment.path || !environment.isGitRepo || environment.status !== "ready") {
        return { href: null };
      }
      return host.call("repository", { path: environment.path }, { hostId: environment.hostId });
    },
  });
}
