# bb-plugin-ekaragodin

Personal plugin for customizing BB.

## Sidebar project labels

Shows a compact project name on a second line below each sidebar thread title, including in chronological mode. Long names truncate. Threads without a known project get no label.

Uses the public sidebar data hook and an app overlay to decorate the existing list. It does not modify thread titles, list preferences, or project data. Disable the plugin to remove all labels.

## Thread review action

Choose **Thermo Nuclear Review** in a thread's actions or right-click menu to start and open a child Codex thread in that thread's project and existing checkout. The action is also available in BB's **Customize actions** picker for sidebar quick actions. It is disabled when the thread has no available checkout.

The initial prompt is: `сделай ревью изменений скиллом cursor-team-kit:thermo-nuclear-code-quality-review`. Install and enable Cursor Team Kit in Codex on the execution machine. The child uses the project's default Codex execution settings and starts with a fresh conversation.

## Development

```sh
npm ci --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install . --yes
```

Reload changes with `bb plugin reload ekaragodin`. Disable with `bb plugin disable ekaragodin`.

Requires BB >=0.47 and Plugin SDK >=0.6.79. The data and lifecycle APIs are public experimental SDK surfaces. Label placement depends on the bundled list's `data-sidebar-thread-id`, `data-sidebar-rename-row`, and `.bb-thread-title` DOM structure; a future BB layout change may require updating the decorator. Other thread-list providers are supported only if they use this structure.
