import { expect, it, vi } from "vitest";
import { createTitleActionController } from "./title-action";

const input = { requestRename: vi.fn() };

it("refreshes the selected thread and exposes progress and the result", async () => {
  const controller = createTitleActionController();
  let finish!: (result: { status: "updated"; title: string }) => void;
  const refresh = vi.fn(() => new Promise<{ status: "updated"; title: string }>(resolve => { finish = resolve; }));
  const first = controller.action("thread-a", refresh).run(input);
  const duplicate = controller.action("thread-a", refresh).run(input);
  expect(controller.action("thread-a", refresh).disabled).toBe(true);
  expect(controller.action("thread-b", refresh).disabled).toBe(false);
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledExactlyOnceWith("thread-a");
  finish({ status: "updated", title: "#123 Fix switching" });
  await Promise.all([first, duplicate]);
  expect(controller.action("thread-a", refresh).disabled).toBe(false);
  expect(controller.getSnapshot().notice).toMatchObject({ message: 'Thread title updated: #123 Fix switching', error: false });
});

it("shows backend failures without rejecting into the thread or preventing retry", async () => {
  const controller = createTitleActionController();
  const refresh = vi.fn().mockResolvedValue({ status: "failed", reason: "Sign in to the selected provider." });
  await controller.action("thread", refresh).run(input);
  expect(controller.getSnapshot().notice).toMatchObject({ message: "Sign in to the selected provider.", error: true });
  controller.dismiss();
  expect(controller.getSnapshot().notice).toBeNull();
  refresh.mockRejectedValueOnce(new Error("RPC offline"));
  await controller.action("thread", refresh).run(input);
  expect(controller.getSnapshot().notice?.message).toBe("Could not refresh the thread title. Try again.");
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("reports unchanged and skipped results and notifies subscribers", async () => {
  const controller = createTitleActionController();
  const listener = vi.fn();
  const unsubscribe = controller.subscribe(listener);
  await controller.action("thread", async () => ({ status: "unchanged", title: "Still relevant" })).run(input);
  expect(controller.getSnapshot().notice?.message).toBe("The current thread title still fits.");
  await controller.action("thread", async () => ({ status: "skipped", reason: "Conversation changed." })).run(input);
  expect(controller.getSnapshot().notice?.message).toBe("Conversation changed.");
  expect(listener).toHaveBeenCalled();
  unsubscribe();
});
