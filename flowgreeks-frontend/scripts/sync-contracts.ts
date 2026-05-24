/**
 * sync-contracts.ts
 *
 * Copies `flowgreeks-engine/contracts/{types,samples,openapi.json}`
 * into `src/contracts/` so the frontend builds against the canonical
 * TS source of truth.
 *
 * Run via:   pnpm sync:contracts
 *
 * Why a script and not a git submodule:
 *   - Submodules introduce CI complexity (auth, shallow clones, lock
 *     ordering) for a 3-file copy.
 *   - The two repos sit side by side in the same workspace; a path
 *     copy is the least magical option.
 *
 * This script is intentionally dependency-free — it uses node:fs only.
 * Run with: tsx scripts/sync-contracts.ts (configured in package.json).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const engineContracts = resolve(repoRoot, "..", "flowgreeks-engine", "contracts");
const target = resolve(repoRoot, "src", "contracts");

if (!existsSync(engineContracts)) {
  console.error(
    `[sync-contracts] expected flowgreeks-engine/contracts at: ${engineContracts}`,
  );
  console.error(
    "[sync-contracts] checkout the engine repo as a sibling directory and re-run.",
  );
  process.exit(1);
}

const subpaths = ["types", "samples", "openapi.json"] as const;

let synced = 0;
let skipped = 0;

for (const sub of subpaths) {
  const src = join(engineContracts, sub);
  const dst = join(target, sub);
  if (!existsSync(src)) {
    console.warn(`[sync-contracts] skipping missing source: ${src}`);
    skipped += 1;
    continue;
  }
  if (existsSync(dst)) {
    rmSync(dst, { recursive: true, force: true });
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });

  const stat = statSync(dst);
  const size = stat.isDirectory() ? sumDir(dst) : stat.size;
  console.log(
    `[sync-contracts] synced ${sub} (${stat.isDirectory() ? "dir" : "file"}, ${size} bytes)`,
  );
  synced += 1;
}

console.log(`[sync-contracts] done — ${synced} synced, ${skipped} skipped`);

function sumDir(p: string): number {
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, entry.name);
    total += entry.isDirectory() ? sumDir(full) : statSync(full).size;
  }
  return total;
}
