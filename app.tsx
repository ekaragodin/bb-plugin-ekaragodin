import { useEffect, useMemo, useSyncExternalStore } from "react";
import { definePluginApp, experimental_THREAD_ACTION_GROUPS, experimental_THREAD_INFO_ROW_GROUPS, experimental_useSidebarThreads, useRpc } from "@get-bb/plugin-sdk/app";
import { decorateThreadRows } from "./labels";
import { createReviewActionFactory } from "./review-action";
import { ThreadSwitcher } from "./thread-switcher-overlay";
import { RepositoryRow } from "./repository-row";
import { createTitleActionController } from "./title-action";
import { TitleSettings, TitleRefreshFeedback } from "./title-settings";
import type { titleContract } from "./title-contract";

function ProjectLabels() {
  const { threads, projects } = experimental_useSidebarThreads();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  // Status updates do not need to recreate the DOM enhancement.
  const labelsKey = JSON.stringify(threads.map((thread) => [
    thread.id, projectNames.get(thread.projectId) ?? "",
  ]));
  useEffect(() => {
    const entries: [string, string][] = JSON.parse(labelsKey);
    return decorateThreadRows(document, new Map(entries));
  }, [labelsKey]);
  return null;
}

export default definePluginApp((app) => {
  const createReviewAction = createReviewActionFactory();
  const titleActions = createTitleActionController();
  app.slots.settingsSection({
    id: "thread-title-generation", title: "Thread titles",
    description: "Refresh titles from the current goal of each conversation.",
    component: TitleSettings,
  });
  app.slots.experimental_appOverlay({
    id: "thread-title-feedback", component: () => <TitleRefreshFeedback controller={titleActions} />,
  });
  app.slots.experimental_threadAction({
    id: "refresh-thread-title", title: "Update title", icon: "RefreshCw",
    group: experimental_THREAD_ACTION_GROUPS.open,
    useData() {
      const snapshot = useSyncExternalStore(titleActions.subscribe, titleActions.getSnapshot);
      const rpc = useRpc<typeof titleContract>();
      return useMemo(() => ({ rpc, snapshot }), [rpc, snapshot]);
    },
    item: ({ thread, data }) => titleActions.action(thread.id,
      threadId => data.rpc.call("refreshTitle", { threadId })),
  });
  app.slots.experimental_threadInfoRow({
    id: "github-repository",
    group: experimental_THREAD_INFO_ROW_GROUPS.git,
    order: -1,
    component: RepositoryRow,
  });
  app.slots.experimental_appOverlay({ id: "project-labels", component: ProjectLabels });
  app.slots.experimental_appOverlay({ id: "thread-switcher", component: ThreadSwitcher });
  app.slots.experimental_threadAction({
    id: "thermo-nuclear-review",
    title: "Thermo Nuclear Review",
    icon: "FileCheck",
    group: experimental_THREAD_ACTION_GROUPS.open,
    item: ({ thread, sdk, navigate }) => createReviewAction(
      thread, (args) => sdk.threads.spawn(args), navigate,
    ),
  });
});
