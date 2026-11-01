import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { repositoryHostContract } from "./repository-contract";
import { githubRepositoryUrl } from "./repository-link";
import { titleHostContract } from "./title-contract";
import { completeTitle } from "./title-provider";

const execFileAsync = promisify(execFile);

export default experimental_defineHostEntry({
  contract: { ...repositoryHostContract, ...titleHostContract },
  handlers: {
    titleComplete(input, { signal, lifecycle }) {
      return completeTitle(input, signal, lifecycle.signal);
    },
    async repository({ path }, { signal }) {
      try {
        const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], {
          cwd: path, signal, timeout: 5000, maxBuffer: 16 * 1024, encoding: "utf8",
        });
        return { href: githubRepositoryUrl(stdout) };
      } catch (error) {
        // `git config --get` exits 1 without output when the key is absent.
        if (error instanceof Error && "code" in error && error.code === 1
          && "stdout" in error && error.stdout === ""
          && "stderr" in error && error.stderr === "") return { href: null };
        throw error;
      }
    },
  },
});
