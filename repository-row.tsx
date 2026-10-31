import {
  experimental_DetailRow as DetailRow,
  experimental_useRpcQuery,
  UrlLink,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { repositoryContract } from "./repository-contract";

export function RepositoryRow({ environment }: ExperimentalThreadInfoProps) {
  const { data, error } = experimental_useRpcQuery({
    contract: repositoryContract,
    method: "repository",
    input: { environmentId: environment?.id ?? "" },
    enabled: !!environment,
  });
  const href = data?.href;

  if (!environment || error || !href) return null;
  return <DetailRow icon="Github" label="Repository">
    <UrlLink href={href} title={href}>
      {href.slice("https://github.com/".length)}
    </UrlLink>
  </DetailRow>;
}
