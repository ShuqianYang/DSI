import { db } from "../../config/database.js";
import { aircraftCurrentStates } from "../../db/schema.js";
import type { NewAircraftCurrentState } from "../../db/schema.js";

export interface ReplaceResult {
  deleted: number;
  inserted: number;
}

/**
 * Atomically replace all aircraft current states.
 * Runs DELETE FROM aircraft_current_states + INSERT new rows in a single transaction.
 * Queries against this table will never see an empty or mixed state.
 */
export async function replaceAll(
  states: NewAircraftCurrentState[]
): Promise<ReplaceResult> {
  return await db.transaction(async (tx) => {
    const deleted = await tx.delete(aircraftCurrentStates);
    if (states.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < states.length; i += batchSize) {
        const batch = states.slice(i, i + batchSize);
        await tx.insert(aircraftCurrentStates).values(batch);
      }
    }
    return { deleted: deleted.rowCount ?? 0, inserted: states.length };
  });
}
