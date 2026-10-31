import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const output = z.object({ href: z.string().nullable() });

export const repositoryContract = defineRpcContract({
  repository: {
    input: z.object({ environmentId: z.string().min(1) }),
    output,
  },
});

export const repositoryHostContract = defineRpcContract({
  repository: {
    input: z.object({ path: z.string().min(1) }),
    output,
    experimental_retryable: true,
  },
});
