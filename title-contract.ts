import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const titleProviderSchema = z.enum(["codex", "claude-code"]);
export type TitleProviderId = z.infer<typeof titleProviderSchema>;
export const titleModelSchema = z.string().max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
export const titleSchema = z.string().trim().min(1).max(120);
export const titleSelectionSchema = z.union([
  z.object({ providerId: titleProviderSchema, model: titleModelSchema }).strict(),
  z.object({ providerId: z.literal(""), model: z.literal("") }).strict(),
]);
export type TitleSelection = z.infer<typeof titleSelectionSchema>;

const providerViewSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  supported: z.boolean(),
  available: z.boolean(),
  reason: z.string().nullable(),
}).strict();
export const titleSettingsViewSchema = z.object({
  providerId: z.string(),
  model: z.string(),
  hostId: z.string().nullable(),
  providers: z.array(providerViewSchema),
  state: z.enum(["unconfigured", "configured", "unavailable"]),
  reason: z.string().nullable(),
}).strict();
export type TitleSettingsView = z.infer<typeof titleSettingsViewSchema>;

export const titleRefreshResultSchema = z.object({
  status: z.enum(["updated", "unchanged", "skipped", "failed"]),
  title: titleSchema.optional(),
  reason: z.string().max(500).optional(),
}).strict();
export type TitleRefreshResult = z.infer<typeof titleRefreshResultSchema>;

export const titleContract = defineRpcContract({
  titleSettings: { input: z.null(), output: titleSettingsViewSchema },
  saveTitleSettings: { input: titleSelectionSchema, output: titleSettingsViewSchema },
  refreshTitle: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: titleRefreshResultSchema,
  },
});

export const titleHostContract = defineRpcContract({
  titleComplete: {
    input: z.object({
      providerId: titleProviderSchema,
      model: titleModelSchema,
      executablePath: z.string().min(1).max(4096),
      prompt: z.string().min(1).max(24_000),
    }).strict(),
    output: z.object({ title: titleSchema }).strict(),
  },
});
