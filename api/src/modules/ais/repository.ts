import type { NewAisCurrentState } from "../../db/schema.js";

export interface ReplaceResult {
  deleted: number;
  inserted: number;
}

/**
 * Atomically replace all AIS current states.
 * Runs DELETE FROM ais_current_states + INSERT new rows in a single transaction.
 * Queries against this table will never see an empty or mixed state.
 */
export async function replaceAll(
  states: NewAisCurrentState[]
): Promise<ReplaceResult> {
  const { db } = await import("../../config/database.js");
  const { aisCurrentStates } = await import("../../db/schema.js");
  return await db.transaction(async (tx) => {
    const deleted = await tx.delete(aisCurrentStates);
    if (states.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < states.length; i += batchSize) {
        const batch = states.slice(i, i + batchSize);
        await tx.insert(aisCurrentStates).values(batch);
      }
    }
    return { deleted: deleted.rowCount ?? 0, inserted: states.length };
  });
}
