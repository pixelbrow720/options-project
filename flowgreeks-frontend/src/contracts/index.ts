/**
 * Contracts barrel.
 *
 * The actual TS types live in `./types/snapshot.ts`, mirrored from the
 * backend repo via `pnpm sync:contracts`. This barrel re-exports the
 * full type surface so feature code imports through one stable path:
 *
 *   import type { GexPayload } from "@/contracts";
 *
 * NEVER hand-edit `./types/snapshot.ts` — it is overwritten on each
 * sync. If the backend payload shape changes, update the source in
 * `flowgreeks-engine/contracts/types/snapshot.ts`, run the engine's
 * `bash scripts/export_contracts.sh`, then this repo's
 * `pnpm sync:contracts`.
 */
export * from "./types/snapshot";
