import { useEffect } from "react";
import { definePluginApp, experimental_THREAD_ACTION_GROUPS, experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { decorateThreadRows } from "./labels";
import { createReviewActionFactory } from "./review-action";

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
  app.slots.experimental_appOverlay({ id: "project-labels", component: ProjectLabels });
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
