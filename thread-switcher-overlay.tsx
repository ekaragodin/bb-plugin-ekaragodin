import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useProviders,
  experimental_useSidebarThreads,
  useBbContext, useBbNavigate,
  useSidebarThreadDraft, useSidebarThreadRowStatus,
  type ExperimentalProviderIconProps, type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { WindowedThreadList } from "./thread-switcher-list";
import { focusPrimaryThreadComposer } from "./thread-switcher-view";
import { createThreadSwitcher, isSwitcherComposerFocused, sidebarThreadOrder, type SwitcherState } from "./thread-switcher";

function SwitcherRow({ thread, provider, projectName, sectionName, selected, index, total }: {
  thread: PluginSidebarThread;
  provider: ExperimentalProviderIconProps["provider"];
  projectName: string;
  sectionName?: string;
  selected: boolean;
  index: number;
  total: number;
}) {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  let indicator = thread.indicator;
  if (hasUnsubmittedDraft) {
    if (["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"].includes(indicator)) {
      indicator = "working-draft";
    } else if (indicator === "none") {
      indicator = "draft";
    }
  }
  return <div id={`ek-switcher-option-${index}`} role="option" aria-posinset={index + 1} aria-setsize={total} aria-selected={selected} className="ek-thread-switcher-row">
    <ProviderIcon providerKind="agent" provider={provider} className="ek-thread-switcher-provider" aria-label={thread.providerId} />
    <div className="ek-thread-switcher-text">
      <div className="ek-thread-switcher-title">{thread.displayTitle}</div>
      <div className="ek-thread-switcher-project">{sectionName ? `${sectionName} · ${projectName}` : projectName}</div>
    </div>
    <span className="ek-thread-switcher-status">
      <ThreadStatusGlyph indicator={indicator} rowStatus={rowStatus} />
    </span>
  </div>;
}

export function ThreadSwitcher() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const { threads, projects, sections } = experimental_useSidebarThreads();
  const { providers } = experimental_useProviders();
  const [state, setState] = useState<SwitcherState | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<{ id: string; from: string | null; expires: number } | null>(null);
  const availableIds = useRef<readonly string[]>([]);
  const latest = useRef({ threadId, navigate });
  useLayoutEffect(() => { latest.current = { threadId, navigate }; });
  const [switcher] = useState(() => createThreadSwitcher({
    isComposerFocused: () => {
      if (!isSwitcherComposerFocused(document)) return false;
      origin.current = document.activeElement as HTMLElement;
      pendingFocus.current = null;
      return true;
    },
    sidebarOrder: () => sidebarThreadOrder(document, availableIds.current),
    changed: setState,
    commit: (id) => {
      pendingFocus.current = { id, from: latest.current.threadId, expires: Date.now() + 5000 };
      latest.current.navigate.toThread(id);
    },
    cancel: (restoreFocus) => {
      if (restoreFocus && origin.current?.isConnected) origin.current.focus({ preventScroll: true });
    },
  }));

  useLayoutEffect(() => {
    availableIds.current = threads.filter(thread => !thread.isArchived && !thread.isHidden).map(thread => thread.id);
    switcher.update(threadId, availableIds.current);
  }, [switcher, threadId, threads]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => switcher.keydown(event);
    const keyup = (event: KeyboardEvent) => switcher.keyup(event);
    const blur = () => { switcher.cancel(false); pendingFocus.current = null; };
    const visibility = () => { if (document.hidden) blur(); };
    const pointer = (event: PointerEvent) => {
      pendingFocus.current = null;
      if (event.target instanceof Node && !list.current?.contains(event.target)) switcher.cancel(false);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      switcher.cancel(false);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, [switcher]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (Date.now() > pending.expires || (threadId !== pending.id && threadId !== pending.from)) {
      pendingFocus.current = null;
      return;
    }
    if (threadId !== pending.id) return;
    let frame: number;
    const focus = () => {
      if (pendingFocus.current !== pending || latest.current.threadId !== pending.id) return;
      if (Date.now() > pending.expires || focusPrimaryThreadComposer(document)) {
        pendingFocus.current = null;
        return;
      }
      frame = requestAnimationFrame(focus);
    };
    frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [threadId, state]);

  if (!state?.visible) return null;
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const sectionNames = new Map(sections.map(section => [section.id, section.name]));
  const providersById = new Map(providers.map(provider => [provider.id, provider]));
  return <div className="ek-thread-switcher-backdrop">
    <style>{`
      .ek-thread-switcher-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .22); }
      .ek-thread-switcher { width: min(520px, 100%); overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--background); color: var(--foreground); box-shadow: 0 16px 64px rgb(0 0 0 / .3); }
      .ek-thread-switcher-heading { padding: 14px 16px 10px; font-size: 13px; font-weight: 600; }
      .ek-thread-switcher-list { max-height: min(448px, calc(100dvh - 180px)); overflow-y: auto; outline: none; padding: 0 6px; }
      .ek-thread-switcher-row { height: 56px; box-sizing: border-box; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 8px; }
      .ek-thread-switcher-row[aria-selected="true"] { background: var(--accent); box-shadow: inset 0 0 0 1px var(--border); }
      .ek-thread-switcher-text { flex: 1; min-width: 0; }
      .ek-thread-switcher-title, .ek-thread-switcher-project { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ek-thread-switcher-title { font-size: 13px; line-height: 20px; }
      .ek-thread-switcher-provider { width: 16px; height: 16px; flex: 0 0 16px; color: var(--muted-foreground); }
      .ek-thread-switcher-status { width: 20px; flex: 0 0 20px; display: flex; align-items: center; justify-content: center; }
      .ek-thread-switcher-project { font-size: 11px; color: var(--muted-foreground); }
      .ek-thread-switcher-project { line-height: 16px; }
      .ek-thread-switcher-footer { padding: 10px 16px 12px; font-size: 11px; color: var(--muted-foreground); }
    `}</style>
    <div className="ek-thread-switcher">
      <div className="ek-thread-switcher-heading" id="ek-thread-switcher-heading">Recent threads</div>
      <WindowedThreadList state={state} listRef={list} renderRow={(id, index) => {
        const thread = byId.get(id);
        if (!thread) return null;
        return <SwitcherRow key={id} thread={thread} index={index} total={state.ids.length} selected={state.selected === index}
          provider={providersById.get(thread.providerId) ?? { id: thread.providerId }}
          projectName={projectNames.get(thread.projectId) ?? "No project"}
          sectionName={thread.sectionId ? sectionNames.get(thread.sectionId) : undefined} />;
      }} />
      <div className="ek-thread-switcher-footer">Ctrl + Tab — next · Shift — previous · Release Ctrl to switch · Esc — cancel</div>
    </div>
  </div>;
}
