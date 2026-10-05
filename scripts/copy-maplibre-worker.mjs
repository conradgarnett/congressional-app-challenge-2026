// MapLibre 6 runs map data processing in a module worker loaded from its own
// file. Next.js bundles MapLibre's main code into a chunk, so the worker's
// default relative URL breaks. Copy the worker (and the shared module it
// imports) into public/ so BusinessMap can point setWorkerUrl at them.
// Runs on npm install and before dev/build; output is git-ignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist");
const target = join(root, "public", "maplibre");

mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(source, file), join(target, file));
}
