import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { repositoryContract, repositoryHostContract } from "./repository-contract";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: repositoryHostContract });
  bb.rpc.register(repositoryContract, {
    async repository({ environmentId }) {
      const environment = await bb.sdk.environments.get({ environmentId });
      if (!environment.path || !environment.isGitRepo || environment.status !== "ready") {
        return { href: null };
      }
      return host.call("repository", { path: environment.path }, { hostId: environment.hostId });
    },
  });
}
