import { z } from "zod";

export interface TitleKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const turnIds = z.array(z.string().min(1).max(200)).max(5).refine(ids => new Set(ids).size === ids.length);
const stateSchema = z.object({
  version: z.literal(1),
  cursor: z.number().int().nonnegative(),
  successfulTurnIds: turnIds,
}).strict();
// Older installations persisted an attempt list; the cursor and successful IDs already prevent replay.
const storedStateSchema = stateSchema.extend({ attemptedTurnIds: z.unknown().optional() })
  .transform(({ attemptedTurnIds: _legacy, ...state }) => state);
export type TitleTurnState = z.infer<typeof stateSchema>;

export function createTitleState(kv: TitleKv) {
  return {
    async read(threadId: string): Promise<TitleTurnState> {
      const stored = await kv.get<unknown>(`title-turns:${threadId}`);
      if (stored === undefined) return { version: 1, cursor: 0, successfulTurnIds: [] };
      const parsed = storedStateSchema.safeParse(stored);
      if (!parsed.success) throw new Error("The stored title turn state is invalid.");
      return parsed.data;
    },
    async write(threadId: string, state: TitleTurnState): Promise<void> {
      await kv.set(`title-turns:${threadId}`, stateSchema.parse(state));
    },
  };
}
