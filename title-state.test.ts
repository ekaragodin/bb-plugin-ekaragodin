import { expect, it } from "vitest";
import { createTitleState, type TitleKv } from "./title-state";

function store(): TitleKv {
  const values = new Map<string, unknown>();
  return { async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async set(key, value) { values.set(key, structuredClone(value)); } };
}

it("persists only bounded turn bookkeeping across state instances", async () => {
  const kv = store();
  const first = createTitleState(kv);
  const state = await first.read("thread");
  state.cursor = 12;
  state.successfulTurnIds.push("turn1");
  await first.write("thread", state);
  expect(await createTitleState(kv).read("thread")).toEqual({ version: 1, cursor: 12,
    successfulTurnIds: ["turn1"] });
  expect(await first.read("other")).toEqual({ version: 1, cursor: 0, successfulTurnIds: [] });
});

it("refuses corrupted bookkeeping rather than replaying paid calls", async () => {
  const kv: TitleKv = { async get<T>() { return { version: 0, cursor: -1 } as T; }, async set() {} };
  await expect(createTitleState(kv).read("thread")).rejects.toThrow("stored title turn state");
});

it("refuses duplicate successful turn IDs", async () => {
  const state = createTitleState(store());
  await expect(state.write("thread", { version: 1, cursor: 2, successfulTurnIds: ["x", "x"] })).rejects.toThrow();
});

it("reads previously persisted state without replaying or retaining its redundant attempt list", async () => {
  const kv = store();
  await kv.set("title-turns:thread", { version: 1, cursor: 12,
    successfulTurnIds: ["turn1"], attemptedTurnIds: ["turn1"] });
  const state = createTitleState(kv);
  const loaded = await state.read("thread");
  expect(loaded).toEqual({ version: 1, cursor: 12, successfulTurnIds: ["turn1"] });
  await state.write("thread", loaded);
  expect(await kv.get("title-turns:thread")).toEqual(loaded);
});
