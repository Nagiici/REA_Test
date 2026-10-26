import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { EnvironmentRouteGenerator } from '../src/environment-layout.js';

const assetRoot = new URL('../public/assets/recovered/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, assetRoot)));
const library = read('route-library.json');
library.modelBindings = read(library.modelBindingsFile);
const manifest = read('manifest.json');
const environmentBindings = read(manifest.environmentBindings);
const landingId = 'routes/default/chunks/routechunk_default_jetpack_landing';

test('landing scheduling preserves the built edge and section minimum, rounded to the source 180 grid', () => {
  const source = new SourceRouteGenerator(library);
  const first = source.nextChunk({ startDistance: 0, speed: 11 });
  const sectionMinimum = source.currentSection.startDistance + source.currentSection.fields._lengthMin * .1;
  const target = source.scheduleJetpackLanding(12.3, first.length);
  assert.equal(target, Math.ceil(Math.max(18, first.length, sectionMinimum) / 18) * 18);
  assert.equal(source.pendingJetpackLanding.adapter, 'browser-queue-packing');
  const result = source.nextChunk({ startDistance: target, speed: 11 });
  assert.equal(result.provenance.chunkId, landingId);
  assert.equal(result.length, 18);
  assert.equal(result.entities.length, 0, 'source landing chunk is logically empty');
  assert.equal(result.provenance.jetpackLanding.kind, 'landing');
  assert.equal(source.pendingJetpackLanding, null);
  const next = source.nextChunk({ startDistance: target + result.length, speed: 11 });
  assert.ok(next.provenance.sectionId);
  assert.ok(!next.provenance.jetpackLanding);
});

test('all pending approach chunks fit exactly before landing across source sections and seeds', () => {
  for (let seed = 1; seed <= 16; seed++) {
    const source = new SourceRouteGenerator(library, { seed });
    let edge = 0;
    const built = [];
    for (let index = 0; index < 8; index++) {
      const result = source.nextChunk({ startDistance: edge, speed: 11 });
      built.push(result); edge += result.length;
    }
    const snapshots = built.map(result => JSON.stringify(result));
    const target = source.scheduleJetpackLanding(edge + 19 + seed * 7, edge);
    let found = false;
    for (let index = 0; index < 30; index++) {
      const result = source.nextChunk({ startDistance: edge, speed: 11 });
      if (result.provenance.jetpackLanding?.kind === 'landing') {
        assert.equal(edge, target);
        assert.equal(result.provenance.chunkId, landingId);
        found = true;
        break;
      }
      assert.ok(edge + result.length <= target + 1e-7, `seed ${seed}: crossing chunk`);
      assert.ok(source.currentSection.startDistance + source.currentSection.fields._lengthMin * .1 <= target + 1e-7,
        `seed ${seed}: new section would overrun the target`);
      edge += result.length;
    }
    assert.ok(found, `seed ${seed}: landing not reached`);
    assert.deepEqual(built.map(result => JSON.stringify(result)), snapshots, 'already built course is immutable');
  }
});

test('a rejected long candidate is packed with the actual fallback chunk without stretching its geometry', () => {
  const source = new SourceRouteGenerator(library);
  const first = source.nextChunk({ startDistance: 0 });
  const old = source.currentSection;
  source.currentSection = { ...old, phase: 1, startDistance: first.length,
    fields: { ...old.fields, _lengthMin: 0, _middleChunkCountLimited: false },
    pools: [[], [{ Weight: 1, prefabPath: first.provenance.chunkId }], []], picked: new Set() };
  const target = source.scheduleJetpackLanding(first.length + 18, first.length);
  const filler = source.nextChunk({ startDistance: first.length });
  assert.equal(filler.provenance.chunkId, source.fallbackChunkId());
  assert.equal(filler.provenance.jetpackLanding.kind, 'padding');
  assert.equal(filler.length, 18);
  assert.equal(source.nextChunk({ startDistance: target }).provenance.chunkId, landingId);
});

test('environment wrapper forwards the queue and gives the original landing safe ground and supported city scenery', () => {
  const wrapped = new EnvironmentRouteGenerator(new SourceRouteGenerator(library), environmentBindings);
  const first = wrapped.nextChunk({ startDistance: 0 });
  const target = wrapped.scheduleJetpackLanding(first.length, first.length);
  assert.equal(wrapped.pendingJetpackLanding.target, target);
  const landing = wrapped.nextChunk({ startDistance: target });
  assert.equal(landing.provenance.chunkId, landingId);
  assert.ok(landing.entities.some(entity => entity.provenance.groundSource));
  assert.ok(landing.entities.every(entity => entity.type === 'decoration'));
  assert.equal(landing.provenance.environment._type, 1);
  wrapped.reset(48709);
  assert.equal(wrapped.pendingJetpackLanding, null);
});

test('default SpawnPoint effect support now includes the original Jetpack candidate', () => {
  const source = new SourceRouteGenerator(library);
  assert.ok(source.enabledPowerups.has('jetpack'));
  assert.throws(() => source.scheduleJetpackLanding(NaN, 0), /Invalid Jetpack/);
  source.scheduleJetpackLanding(18, 0);
  assert.throws(() => source.nextChunk({ startDistance: 36 }), /passed the scheduled/);
});
