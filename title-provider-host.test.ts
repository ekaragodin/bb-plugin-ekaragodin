import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { titleHostContract } from "./title-contract";
import { completeTitle } from "./title-provider";

const directories: string[] = [];
const systemSetTimeout = setTimeout;
async function until(predicate: () => boolean) {
  for (let count = 0; count < 100; count += 1) {
    if (predicate()) return;
    await new Promise<void>(resolve => systemSetTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for fixture state");
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture(source: string, help = "--ignore-user-config --ignore-rules --strict-config --ephemeral --output-schema") {
  const directory = await mkdtemp(join(tmpdir(), "title-provider-host-"));
  directories.push(directory);
  const path = join(directory, "provider");
  const report = join(directory, "started.json");
  const childReady = join(directory, "child-ready");
  await writeFile(path, `#!${process.execPath}\nconst fs = require("node:fs"); const {spawn} = require("node:child_process");\nif (process.argv.includes("--help")) { console.log(${JSON.stringify(help)}); process.exit(0); }\nprocess.stdin.resume(); process.stdin.on("end", () => { fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({pid:process.pid,cwd:process.cwd()}));\n${source.replaceAll("CHILD_READY", JSON.stringify(childReady))}\n});\n`);
  await chmod(path, 0o700);
  return { path, report, childReady };
}
const input = (executablePath: string) => ({ providerId: "codex" as const, model: "small", executablePath, prompt: "conversation" });
const entry = experimental_defineHostEntry({
  contract: titleHostContract,
  handlers: { titleComplete: (request, context) => completeTitle(request, context.signal, context.lifecycle.signal) },
});

it("checks CLI isolation capabilities before sending any prompt", async () => {
  const f = await fixture('process.exit(0);', "unrelated flags");
  await expect(completeTitle(input(f.path), new AbortController().signal)).rejects.toThrow(/does not support/i);
  expect(existsSync(f.report)).toBe(false);
});

it("bounds combined provider output and cleans its temporary directory", async () => {
  const f = await fixture('process.stdout.write("x".repeat(150000)); process.stderr.write("y".repeat(150000));');
  await expect(completeTitle(input(f.path), new AbortController().signal)).rejects.toThrow(/output limit/i);
  const report = JSON.parse(await readFile(f.report, "utf8"));
  expect(existsSync(report.cwd)).toBe(false);
});

it("rejects a Claude authentication error even when its result subtype says success", async () => {
  const reply = { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" };
  const f = await fixture(`process.stdout.write(${JSON.stringify(JSON.stringify(reply))});`, "--restricted --tools --strict-mcp-config --setting-sources --no-session-persistence --permission-prompts --json-schema");
  await expect(completeTitle({ ...input(f.path), providerId: "claude-code" }, new AbortController().signal)).rejects.toThrow(/invalid final title/i);
});

it("cancels a real CLI process on the request signal", async () => {
  const f = await fixture('setInterval(() => {}, 1000);');
  const controller = new AbortController();
  const request = completeTitle(input(f.path), controller.signal).catch(error => error);
  await until(() => existsSync(f.report));
  const report = JSON.parse(await readFile(f.report, "utf8"));
  controller.abort();
  expect(await request).toBeInstanceOf(Error);
  expect(alive(report.pid)).toBe(false);
  expect(existsSync(report.cwd)).toBe(false);
});

it.skipIf(process.platform === "win32")("disposal terminates a resistant descendant process as well as its CLI", async () => {
  const f = await fixture(`
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(' + JSON.stringify(CHILD_READY) + ', String(process.pid)); setInterval(() => {}, 1000);'], {stdio:"ignore"});
setInterval(() => {}, 1000);
`);
  const harness = experimental_createHostEntryHarness(entry);
  const request = harness.experimental_call("titleComplete", input(f.path)).catch(error => error);
  try {
    await until(() => existsSync(f.childReady));
    const report = JSON.parse(await readFile(f.report, "utf8"));
    const childPid = Number(await readFile(f.childReady, "utf8"));
    await harness.experimental_dispose();
    expect(await request).toBeInstanceOf(Error);
    await until(() => !alive(report.pid) && !alive(childPid) && !existsSync(report.cwd));
  } finally {
    await harness.experimental_dispose();
  }
});

it("enforces the request deadline instead of waiting for a silent CLI forever", async () => {
  const f = await fixture('setInterval(() => {}, 1000);');
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const request = completeTitle(input(f.path), new AbortController().signal).catch(error => error);
  await until(() => existsSync(f.report));
  await vi.advanceTimersByTimeAsync(60_250);
  vi.useRealTimers();
  const error = await request;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/timed out/i);
  const report = JSON.parse(await readFile(f.report, "utf8"));
  expect(alive(report.pid)).toBe(false);
  expect(existsSync(report.cwd)).toBe(false);
});
