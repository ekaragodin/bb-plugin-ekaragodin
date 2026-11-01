import { expect, it } from "vitest";
import { titleContract, titleHostContract } from "./title-contract";

it("accepts a refresh for one thread and rejects executable injection", () => {
  expect(titleContract.refreshTitle.input.parse({ threadId: "thread" })).toEqual({ threadId: "thread" });
  expect(() => titleContract.refreshTitle.input.parse({ threadId: "thread", executablePath: "/bin/sh" })).toThrow();
});

it("accepts only supported provider settings or an explicit clear", () => {
  const input = titleContract.saveTitleSettings.input;
  expect(input.parse({ providerId: "codex", model: "gpt-small" })).toEqual({ providerId: "codex", model: "gpt-small" });
  expect(input.parse({ providerId: "", model: "" })).toEqual({ providerId: "", model: "" });
  for (const value of [
    { providerId: "pi", model: "small" },
    { providerId: "codex", model: "" },
    { providerId: "", model: "small" },
    { providerId: "codex", model: "x".repeat(201) },
    { providerId: "codex", model: "small", hostId: "other" },
  ]) expect(() => input.parse(value)).toThrow();
});

it("bounds host generation input and does not allow automatic RPC retry", () => {
  const input = { providerId: "claude-code", model: "haiku", executablePath: "/usr/bin/claude", prompt: "Pick a title" };
  expect(titleHostContract.titleComplete.input.parse(input)).toEqual(input);
  expect(() => titleHostContract.titleComplete.input.parse({ ...input, prompt: "x".repeat(24_001) })).toThrow();
  expect(() => titleHostContract.titleComplete.output.parse({ title: "" })).toThrow();
  expect(() => titleHostContract.titleComplete.output.parse({ title: "x".repeat(121) })).toThrow();
  expect("experimental_retryable" in titleHostContract.titleComplete).toBe(false);
});

it("counts Unicode title characters consistently at the host boundary", () => {
  const title = "📚".repeat(120);
  expect(titleHostContract.titleComplete.output.parse({ title })).toEqual({ title });
  expect(() => titleHostContract.titleComplete.output.parse({ title: title + "📚" })).toThrow();
});
