import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import host from "./host";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("propagates filesystem and Git configuration failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "repository-link-errors-"));
  directories.push(root);
  execFileSync("git", ["init", root]);
  const harness = experimental_createHostEntryHarness(host);
  try {
    await expect(harness.experimental_call("repository", { path: join(root, "missing") })).rejects.toThrow();
    writeFileSync(join(root, ".git", "config"), "[invalid config\n");
    await expect(harness.experimental_call("repository", { path: root })).rejects.toThrow();
  } finally {
    await harness.experimental_dispose();
  }
});

it("reads origin for both a checkout and its linked worktree", async () => {
  const root = mkdtempSync(join(tmpdir(), "repository-link-"));
  directories.push(root);
  const checkout = join(root, "checkout");
  const worktree = join(root, "worktree");
  execFileSync("git", ["init", checkout]);
  const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args]);
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
    "commit", "--allow-empty", "-m", "Initial");
  git("remote", "add", "origin", "git@github.com:owner/repo.git");
  git("worktree", "add", "-b", "linked", worktree);
  const harness = experimental_createHostEntryHarness(host);
  try {
    for (const path of [checkout, worktree]) {
      expect(await harness.experimental_call("repository", { path })).toEqual({ href: "https://github.com/owner/repo" });
    }
    git("remote", "set-url", "origin", "git@gitlab.com:owner/repo.git");
    expect(await harness.experimental_call("repository", { path: checkout })).toEqual({ href: null });
    git("remote", "remove", "origin");
    expect(await harness.experimental_call("repository", { path: checkout })).toEqual({ href: null });
    expect(await harness.experimental_call("repository", { path: root })).toEqual({ href: null });
  } finally {
    await harness.experimental_dispose();
  }
});
