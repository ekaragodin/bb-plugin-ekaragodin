# bb-plugin-ekaragodin

Personal plugin for customizing BB.

## Repository link

The thread's Info tab shows **Repository** before **Branch** when the project's
checkout's `origin` is on github.com. The read runs Git on the environment's
machine and supports worktrees. SSH, HTTPS, HTTP and Git remote URLs become a clean
HTTPS link to `owner/repo`. Projects without a GitHub remote show no row.

## Sidebar project labels

Shows a compact project name on a second line below each sidebar thread title, including in chronological mode. Long names truncate. Threads without a known project get no label.

Uses the public sidebar data hook and an app overlay to decorate the existing list. It does not modify thread titles, list preferences, or project data. Disable the plugin to remove all labels.

## Thread review action

Choose **Thermo Nuclear Review** in a thread's actions or right-click menu to start and open a child Codex thread in that thread's project and existing checkout. The action is also available in BB's **Customize actions** picker for sidebar quick actions. It is disabled when the thread has no available checkout.

The initial prompt is: `Review the changes using the cursor-team-kit:thermo-nuclear-code-quality-review skill.`. Install and enable Cursor Team Kit in Codex on the execution machine. The child uses the project's default Codex execution settings and starts with a fresh conversation.

## Thread title refresh

Choose **Update title** in a thread's actions or right-click menu to generate a
short title for its current goal. The action is also available in **Customize
actions**. When the current goal concerns a known ticket, its number goes first.
A suitable existing title stays unchanged.

In the plugin's **Thread titles** settings, select a provider and a small model.
This one selection applies to every thread, independently of the thread's own
provider. Generation runs on BB's primary machine through its existing CLI login.
Codex and Claude Code are supported; other providers are shown as unsupported.
The chosen CLI must be installed and signed in on that machine. Older CLI
versions without the required isolation controls fail without changing the title.
No model is selected automatically.

The same action runs automatically after each of a thread's first five successful
agent turns, counted over its lifetime. Failed and interrupted turns do not count.
Manual renaming does not stop these automatic updates. Historical turns are not
replayed when the plugin loads, and failed automatic attempts are not retried.
After the fifth successful turn, use the action manually.

The model receives the current title and the first three/latest six conversation
messages, deduplicated and shortened to fit a bounded context. Tool output,
reasoning and attachment bodies are excluded. Generation creates no helper BB
threads or transcript messages. Errors preserve the title and appear outside the
conversation when the action is run manually. Changes to the title, conversation
or model selection during generation discard its result. BB's public title API
has no atomic comparison, so a narrow race with another title writer remains.

Agents can use the same backend operation through the discoverable
`refreshTitle` RPC; inspect it with `bb plugin rpc list ekaragodin`.

## Recent thread switcher

With the caret in BB's main thread composer or the new-thread composer, hold **Ctrl** and press **Tab** to
select another thread (the previously visited thread once navigation history exists). Keep pressing Tab to move through recent
visits, or **Shift+Tab** to move backward. Release Ctrl to open the selection
and focus its composer. **Esc** or leaving the window cancels the selection.

The list stays hidden for the first **100 ms after the initial Ctrl+Tab**.
Releasing Ctrl within that time (including exactly 100 ms) opens the selection
without showing the list. Holding Ctrl longer reveals the list automatically.
All Tab and Shift+Tab presses count during the delay; they do not restart it.

The centered list shows thread titles, projects, native agent icons and BB sidebar
status glyphs (including draft and plugin status), with up to eight
visible rows; only the viewport and a small overscan window are mounted, even
for large catalogs. Threads in a named group show `Group · Project` below the title;
ungrouped threads show only the project. It starts with all available threads in sidebar row order;
threads from collapsed or offscreen groups follow the rendered rows. Subsequent
visits take MRU priority, with unvisited threads following in sidebar order.
The list spans all projects and includes child threads. Archived,
hidden and deleted threads are excluded. Background activity never changes the
visit order, which stays fixed during selection. With no other available thread,
the shortcut does nothing.

History lives only in the current window's memory and starts when the plugin
loads; it is reset by a page refresh or plugin reload. Drafts stay under BB's
normal draft handling. Other inputs and right-panel tabs keep BB's shortcuts.
From new-thread compose, the first forward step selects the most recently visited
thread, or the first sidebar entry before any visits; reverse starts at the last
entry. Canceling keeps the new-thread draft and returns focus to its editor.

The focus guard uses the built-in editors' `thread-detail-follow-up-composer`
and `root-compose-prompt` DOM ids; a custom composer or future BB markup change may require adapting it.

## Development

```sh
npm ci --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install . --yes
```

Reload changes with `bb plugin reload ekaragodin`. Disable with `bb plugin disable ekaragodin`.

Requires BB >=0.48.1 and Plugin SDK >=0.6.104. The data and lifecycle APIs are public experimental SDK surfaces. Label placement depends on the bundled list's `data-sidebar-thread-id`, `data-sidebar-rename-row`, and `.bb-thread-title` DOM structure; a future BB layout change may require updating the decorator. Other thread-list providers are supported only if they use this structure.

### Optional live checks

The normal suite uses synthetic processes and SDK fixtures. To call an actual
model, explicitly provide its executable and model; these checks use synthetic
conversation data and consume provider usage.

```sh
TITLE_SMOKE_CODEX_PATH=/absolute/path/to/codex TITLE_SMOKE_CODEX_MODEL=gpt-6-luna npm test -- title-provider.live.test.ts
TITLE_SMOKE_CLAUDE_PATH=/absolute/path/to/claude TITLE_SMOKE_CLAUDE_MODEL=haiku npm test -- title-provider.live.test.ts
TITLE_SMOKE_THREAD_ID=your-thread-id npm test -- title-context.live.test.ts
```

The context check reads the thread through the current BB session's
`BB_SERVER_URL` and does not change it. A mocked provider response does not prove
login, model access or runtime isolation.
