import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { beforeEach, expect, it, vi } from "vitest";
import { createReviewActionFactory } from "./review-action";

let createReviewAction = createReviewActionFactory();
beforeEach(() => { createReviewAction = createReviewActionFactory(); });

const thread: PluginThreadActionTarget = {
  id: "parent-thread",
  projectId: "target-project",
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  sectionId: null,
  isUnread: false,
  status: "idle",
  environment: { id: "target-checkout", path: "/project" },
};
const input = { requestRename: vi.fn() };

it("starts a child review in the target thread's project and checkout, then opens it", async () => {
  const spawn = vi.fn().mockResolvedValue({ id: "review-thread" });
  const navigate = { toThread: vi.fn() };
  const action = createReviewAction(thread, spawn, navigate);
  expect(action.disabled).toBe(false);
  await action.run(input);
  expect(spawn).toHaveBeenCalledExactlyOnceWith({
    projectId: "target-project",
    parentThreadId: "parent-thread",
    environment: { type: "reuse", environmentId: "target-checkout" },
    providerId: "codex",
    title: "Thermo Nuclear Review",
    prompt: "сделай ревью изменений скиллом cursor-team-kit:thermo-nuclear-code-quality-review",
  });
  expect(navigate.toThread).toHaveBeenCalledExactlyOnceWith("review-thread");
});

it.each([null, { id: "no-checkout", path: null }])("cannot start a review without an available checkout (%j)", async (environment) => {
  const spawn = vi.fn();
  const navigate = { toThread: vi.fn() };
  const action = createReviewAction({ ...thread, environment }, spawn, navigate);
  expect(action.disabled).toBe(true);
  await action.run(input);
  expect(spawn).not.toHaveBeenCalled();
  expect(navigate.toThread).not.toHaveBeenCalled();
});

it("propagates spawn failures without navigating and allows retry", async () => {
  const spawn = vi.fn().mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({ id: "review-thread" });
  const navigate = { toThread: vi.fn() };
  const action = createReviewAction(thread, spawn, navigate);
  await expect(action.run(input)).rejects.toThrow("Unavailable");
  expect(navigate.toThread).not.toHaveBeenCalled();
  await createReviewAction(thread, spawn, navigate).run(input);
  expect(navigate.toThread).toHaveBeenCalledExactlyOnceWith("review-thread");
});

it("prevents simultaneous launches from different action instances for the same parent", async () => {
  let finish!: (child: { id: string }) => void;
  const result = new Promise<{ id: string }>((resolve) => { finish = resolve; });
  const spawn = vi.fn(() => result);
  const navigate = { toThread: vi.fn() };
  const first = createReviewAction(thread, spawn, navigate);
  const second = createReviewAction(thread, spawn, navigate);
  const pending = first.run(input);
  const duplicate = second.run(input);
  const calls = spawn.mock.calls.length;
  finish({ id: "review-thread" });
  await Promise.all([pending, duplicate]);
  expect(calls).toBe(1);
  expect(navigate.toThread).toHaveBeenCalledTimes(1);
  await createReviewAction(thread, spawn, navigate).run(input);
  expect(spawn).toHaveBeenCalledTimes(2);
});

it("allows reviews for different parent threads to start independently", async () => {
  let finish!: (child: { id: string }) => void;
  const result = new Promise<{ id: string }>((resolve) => { finish = resolve; });
  const spawn = vi.fn(() => result);
  const navigate = { toThread: vi.fn() };
  const first = createReviewAction(thread, spawn, navigate).run(input);
  const second = createReviewAction({ ...thread, id: "another-parent" }, spawn, navigate).run(input);
  const calls = spawn.mock.calls.length;
  finish({ id: "review-thread" });
  await Promise.all([first, second]);
  expect(calls).toBe(2);
});
