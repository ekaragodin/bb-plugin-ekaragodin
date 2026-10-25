import type { BbNavigate, PluginBrowserBbSdk, PluginThreadAction, PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";

export const REVIEW_PROMPT = "сделай ревью изменений скиллом cursor-team-kit:thermo-nuclear-code-quality-review";

type Spawn = (args: Parameters<PluginBrowserBbSdk["threads"]["spawn"]>[0]) => Promise<{ id: string }>;

export function createReviewActionFactory() {
  const running = new Set<string>();
  return function createReviewAction(
    thread: PluginThreadActionTarget,
    spawn: Spawn,
    navigate: Pick<BbNavigate, "toThread">,
  ): PluginThreadAction {
    const environment = thread.environment;
    return {
      label: "Thermo Nuclear Review",
      icon: "FileCheck",
      detail: environment?.path ? "Запустить ревью в дочернем треде" : "Окружение треда недоступно",
      disabled: !environment?.path,
      async run() {
        if (!environment?.path || running.has(thread.id)) return;
        running.add(thread.id);
        try {
          const child = await spawn({
            projectId: thread.projectId,
            parentThreadId: thread.id,
            environment: { type: "reuse", environmentId: environment.id },
            providerId: "codex",
            title: "Thermo Nuclear Review",
            prompt: REVIEW_PROMPT,
          });
          navigate.toThread(child.id);
        } finally {
          running.delete(thread.id);
        }
      },
    };
  };
}
