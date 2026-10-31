import { expect, it } from "vitest";
import { githubRepositoryUrl } from "./repository-link";

it.each([
  "git@github.com:owner/repo.git",
  "ssh://git@github.com/owner/repo.git",
  "https://github.com/owner/repo.git",
  "https://github.com/owner/repo/",
  "http://github.com/owner/repo",
  "git://github.com/owner/repo.git",
  " https://github.com/owner/repo ",
  "https://user:password@github.com/owner/repo.git",
])("converts %s into a credential-free GitHub web URL", (remote) => {
  expect(githubRepositoryUrl(remote)).toBe("https://github.com/owner/repo");
});

it.each([
  null, "", "/local/repo", "git@gitlab.com:owner/repo.git",
  "https://github.com.evil.example/owner/repo", "https://github.com/owner",
  "https://github.com/owner/repo/tree/main", "https://github.com/owner/repo?token=secret",
  "https://github.com/owner/repo#fragment", "https://github.com:123/owner/repo",
  "file://github.com/owner/repo", "https://github.com/owner/%2e%2e",
  "git@github.com:owner/..", "git@github.com:owner/repo with space",
])("hides missing, non-GitHub or invalid remotes (%s)", (remote) => {
  expect(githubRepositoryUrl(remote)).toBeNull();
});
