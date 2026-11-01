import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { z } from "zod";
import { titleHostContract } from "./title-contract";

type TitleCompleteInput = z.infer<typeof titleHostContract.titleComplete.input>;

const outputLimit = 256 * 1024;
const deadlineMs = 60_000;
const resultSchema = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
};
const disabledCodexFeatures = [
  "shell_tool", "apps", "multi_agent", "hooks", "memories", "remote_plugin", "plugins",
  "view_image", "image_generation", "computer_use", "browser_use", "browser_use_external",
  "code_mode", "code_mode_host", "sleep_tool", "tool_suggest",
];

function providerEnvironment(providerId: TitleCompleteInput["providerId"]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("BB_") || (name.startsWith("CODEX_") && name !== "CODEX_HOME")
      || /^(?:CLAUDECODE|CLAUDE_SESSION_ID|CLAUDE_CODE_SESSION_ID|NODE_OPTIONS|NODE_PATH|BASH_ENV|ENV|LD_PRELOAD|ELECTRON_RUN_AS_NODE)$/u.test(name)
      || name.startsWith("DYLD_")) delete env[name];
  }
  if (providerId === "claude-code") {
    Object.assign(env, {
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
      DISABLE_AUTOUPDATER: "1",
      DISABLE_TELEMETRY: "1",
      DISABLE_ERROR_REPORTING: "1",
    });
  }
  return env;
}

function invocation(input: TitleCompleteInput, schemaPath: string): string[] {
  if (input.providerId === "codex") {
    return [
      "exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral",
      "--skip-git-repo-check", "--sandbox", "read-only", "--model", input.model,
      "--json", "--output-schema", schemaPath,
      ...disabledCodexFeatures.flatMap(name => ["-c", `features.${name}=false`]),
      "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0", "-",
    ];
  }
  return [
    "--print", "--restricted", "--tools", "", "--disallowedTools", "mcp__*",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
    "--settings", '{"disableAllHooks":true,"autoMemoryEnabled":false}',
    "--no-session-persistence", "--disable-slash-commands", "--no-chrome",
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--system-prompt", "Generate only a concise thread title from the supplied conversation data. Never use tools.",
    "--json-schema", JSON.stringify(resultSchema), "--output-format", "json", "--model", input.model,
  ];
}

function isToolEvent(line: string): boolean {
  let event: unknown;
  try { event = JSON.parse(line); } catch { return false; }
  if (typeof event !== "object" || event === null || !("item" in event)) return false;
  const item = event.item;
  if (typeof item !== "object" || item === null || !("type" in item)) return false;
  return !["agent_message", "reasoning", "error"].includes(String(item.type));
}

async function runCli(
  executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
  stdin: string, signal: AbortSignal, deadline: number, watchTools: boolean,
): Promise<string> {
  signal.throwIfAborted();
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Title generation timed out.");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let lineBuffer = "";
    let bytes = 0;
    let failure: Error | undefined;
    let terminating: Promise<void> | undefined;
    const killGroup = (force: boolean) => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => {});
      } else {
        try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
        catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) child.kill(force ? "SIGKILL" : "SIGTERM"); }
      }
    };
    const fail = (message: string) => {
      failure ??= new Error(message);
      if (!terminating) {
        killGroup(false);
        terminating = new Promise<void>(done => setTimeout(() => { killGroup(true); done(); }, 250));
      }
    };
    const onAbort = () => fail("Title generation was cancelled.");
    signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => fail("Title generation timed out."), remaining);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const account = (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > outputLimit) fail("The title provider exceeded its output limit.");
      return !failure;
    };
    child.stdout.on("data", (chunk: string) => {
      if (!account(chunk)) return;
      stdout += chunk;
      if (!watchTools) return;
      lineBuffer += chunk;
      let newline: number;
      while ((newline = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, newline);
        lineBuffer = lineBuffer.slice(newline + 1);
        if (isToolEvent(line)) fail("The title provider attempted to use a tool.");
      }
    });
    child.stderr.on("data", (chunk: string) => { account(chunk); });
    child.stdin.on("error", () => {});
    child.on("error", () => fail("The title provider CLI could not be started."));
    child.on("close", async code => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (watchTools && isToolEvent(lineBuffer)) failure ??= new Error("The title provider attempted to use a tool.");
      if (terminating) await terminating;
      else killGroup(true);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error("The title provider CLI failed. Check its login, model and version."));
      else resolve(stdout);
    });
    child.stdin.end(stdin);
    if (signal.aborted) onAbort();
  });
}

function parseTitle(stdout: string, providerId: TitleCompleteInput["providerId"]): string {
  let candidate: unknown;
  try {
    if (providerId === "codex") {
      const events = stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
      if (!events.some(event => event.type === "turn.completed") || events.some(event => event.type === "turn.failed" || event.type === "error")) throw new Error();
      const message = events.filter(event => event.type === "item.completed" && event.item?.type === "agent_message").at(-1);
      candidate = JSON.parse(message?.item.text ?? "");
    } else {
      const result = JSON.parse(stdout);
      if (result.type !== "result" || result.subtype !== "success" || result.is_error
        || (Array.isArray(result.permission_denials) && result.permission_denials.length)) throw new Error();
      candidate = result.structured_output ?? JSON.parse(result.result);
    }
    if (typeof candidate !== "object" || candidate === null || Object.keys(candidate).length !== 1 || !("title" in candidate)
      || typeof candidate.title !== "string" || /[\r\n]/u.test(candidate.title)) throw new Error();
    const title = candidate.title.trim().replace(/\s+/gu, " ");
    if (!title || [...title].length > 120) throw new Error();
    return title;
  } catch {
    throw new Error("The title provider returned an invalid final title.");
  }
}

export async function completeTitle(input: TitleCompleteInput, signal: AbortSignal, lifecycleSignal?: AbortSignal): Promise<{ title: string }> {
  input = titleHostContract.titleComplete.input.parse(input);
  if (!isAbsolute(input.executablePath)) throw new Error("The title provider executable is unavailable.");
  const combinedSignal = lifecycleSignal ? AbortSignal.any([signal, lifecycleSignal]) : signal;
  combinedSignal.throwIfAborted();
  const deadline = Date.now() + deadlineMs;
  const directory = await mkdtemp(join(tmpdir(), "bb-title-"));
  try {
    const env = providerEnvironment(input.providerId);
    const help = await runCli(input.executablePath, input.providerId === "codex" ? ["exec", "--help"] : ["--help"], directory, env, "", combinedSignal, deadline, false);
    const required = input.providerId === "codex"
      ? ["--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral", "--output-schema"]
      : ["--restricted", "--tools", "--strict-mcp-config", "--setting-sources", "--no-session-persistence", "--permission-prompts", "--json-schema"];
    if (required.some(option => !help.includes(option))) throw new Error("The installed title provider CLI does not support an isolated title request.");
    const schemaPath = join(directory, "title-schema.json");
    await writeFile(schemaPath, JSON.stringify(resultSchema), { mode: 0o600 });
    const stdout = await runCli(input.executablePath, invocation(input, schemaPath), directory, env, input.prompt, combinedSignal, deadline, input.providerId === "codex");
    return { title: parseTitle(stdout, input.providerId) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
