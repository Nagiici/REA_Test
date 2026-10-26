import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { EnvironmentRouteGenerator } from '../src/environment-layout.js';
const base = new URL('../public/assets/recovered/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, base)));
const library = read('route-library.json');
library.modelBindings = read(library.modelBindingsFile);
const bindings = read('environment-bindings.json'), manifest = read('manifest.json');
const sections = new Set(), chunks = new Set(), environments = new Set(), diagnostics = {};
const failures = [];
const powerups = {}, unsupportedPickups = {};
let chunksGenerated = 0, entityCount = 0;
for (let seed = 1; seed <= 4; seed++) {
  const source = new SourceRouteGenerator(library, { seed });
  const generator = new EnvironmentRouteGenerator(source, bindings);
  let startDistance = 0;
  for (let index = 0; index < 100; index++) {
    const result = generator.nextChunk({ startDistance, speed: Math.min(18, 11 + index * 0.07), playerDistance: Math.max(0, startDistance - 180) });
    chunksGenerated++; entityCount += result.entities.length;
    chunks.add(result.provenance.chunkId); sections.add(result.provenance.sectionId);
    for (const run of result.provenance.environmentRuns) environments.add(`${run.kind._type}:${run.kind._density}`);
    for (const entity of result.entities) {
      if (entity.type === 'powerup') powerups[entity.powerup] = (powerups[entity.powerup] ?? 0) + 1;
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.distance)) failures.push({ index, seed, type: 'nonfinite-entity' });
      if (entity.visual && !manifest.prefabs[entity.visual.prefabKey] && !manifest.meshes[entity.visual.meshKey]) failures.push({ index, seed, type: 'missing-model', visual: entity.visual });
    }
    for (const item of result.diagnostics) diagnostics[item.class ?? item.kind] = (diagnostics[item.class ?? item.kind] ?? 0) + 1;
    for (const item of result.diagnostics.filter(item => item.kind === 'selected-pickup-effect-unavailable')) unsupportedPickups[item.field] = (unsupportedPickups[item.field] ?? 0) + 1;
    startDistance += result.length;
  }
}
const report = {
  generatedAt: new Date().toISOString(), seeds: [1, 2, 3, 4], chunksGenerated, entityCount,
  sourceChunkCount: Object.keys(library.routes).length, distinctScheduledChunks: chunks.size,
  distinctSections: sections.size, environments: [...environments].sort(), diagnostics, powerups, unsupportedPickups, failures,
  librarySha256: createHash('sha256').update(fs.readFileSync(new URL('route-library.json', base))).digest('hex'),
};
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
