import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceSpawnPointManager, SOURCE_PICKUPS } from '../src/source-spawn-points.js';
import { SourceRouteGenerator } from '../src/route-generator.js';

const fields = Object.fromEntries(SOURCE_PICKUPS.slice(0, 9).map(item => [item.field, { ref: item.field }]));
const ticketDraw = ticket => () => (ticket + 0.25) / 113;

test('native first-distance gate is strict and consumes no random draw at the boundary', () => {
  const manager = new SourceSpawnPointManager();
  const noDraw = () => { throw new Error('Unexpected random draw'); };
  assert.equal(manager.select(fields, 2000, noDraw).selected, null);
  const result = manager.select(fields, 2001, () => 0);
  assert.equal(result.selected.powerup, 'doubleScore');
  assert.equal(result.decision.totalWeight, 112);
  assert.equal(manager.nextZ, 4401);
  assert.equal(manager.select(fields, 4401, noDraw).selected, null);
});

test('source cumulative integer tickets retain inclusive zero and unsupported reward slots', () => {
  const boundaries = [[0, 11], [29, 11], [30, 7], [43, 7], [44, 8], [69, 8], [70, 9], [98, 9], [99, 18], [100, 18], [101, 5], [112, 5]];
  for (const [ticket, expected] of boundaries) {
    const manager = new SourceSpawnPointManager();
    const result = manager.select(fields, 2001, ticketDraw(ticket));
    assert.equal(result.decision.ticket, ticket);
    assert.equal(result.selected.type, expected, `ticket ${ticket}`);
  }
});

test('jetpack cooldown uses meters times eight and excludes equality without redrawing', () => {
  const manager = new SourceSpawnPointManager();
  manager.select(fields, 2001, ticketDraw(30));
  assert.equal(manager.pickups.find(item => item.type === 7).nextZ, 10001);
  const boundary = manager.select(fields, 10001, () => 0);
  assert.ok(!boundary.decision.candidates.some(item => item.type === 7));
  const after = manager.select(fields, 10002, () => 0, { compulsory: true });
  assert.ok(after.decision.candidates.some(item => item.type === 7));
});

test('empty candidates do not advance the global gate; disabled types stay in the cumulative scan', () => {
  const manager = new SourceSpawnPointManager();
  manager.select({}, 3000, () => { throw new Error('Unexpected random draw'); });
  assert.equal(manager.nextZ, 2000);
  manager.pickups.find(item => item.type === 11).canSpawn = false;
  const next = manager.select(fields, 3000, () => 0);
  assert.equal(next.selected.type, 7, 'a disabled first type passes the same ticket to the next candidate');
  assert.equal(next.decision.totalWeight, 112);
  manager.pickups.forEach(item => { item.canSpawn = false; });
  assert.equal(manager.select(fields, 6000, () => 0).selected, null);
  assert.equal(manager.nextZ, 8400);
});

const library = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json', import.meta.url)));
library.modelBindings = JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${library.modelBindingsFile}`, import.meta.url)));

test('all 36 real SpawnPoints select at most one original child and retain the original trigger', () => {
  const graphs = Object.values(library.routes).filter(graph => graph.nodes.some(node => node.scripts.some(script => script.class === 'SpawnPoint')));
  assert.equal(graphs.reduce((count, graph) => count + graph.nodes.filter(node => node.scripts.some(script => script.class === 'SpawnPoint')).length, 0), 36);
  const seen = new Set();
  let emitted = 0, unavailable = 0;
  for (let seed = 1; seed <= 16; seed++) for (const graph of graphs) {
    const generator = new SourceRouteGenerator(library, { seed });
    const result = generator.compileChunk(graph.id, { startDistance: 300, speed: 11 });
    const selections = result.decisions.filter(item => item.type === 'SpawnPoint' && item.selected);
    const pickups = result.entities.filter(item => item.type === 'powerup');
    const empty = result.diagnostics.filter(item => item.kind === 'selected-pickup-effect-unavailable');
    assert.equal(pickups.length + empty.length, selections.length);
    for (const pickup of pickups) {
      seen.add(pickup.powerup); emitted++;
      assert.equal(pickup.visual.prefabKey, `powerup_${pickup.powerup}`);
      assert.ok(pickup.visual.matrix.every(Number.isFinite));
      assert.ok(pickup.sourcePickupTrigger.center.every(Number.isFinite));
      assert.ok(Math.abs(pickup.sourcePickupTrigger.radius - 0.7) < 1e-7);
      assert.ok(Math.abs(pickup.sourcePickupTrigger.center[1] - pickup.y) < 1e-7);
      const selected = selections.find(item => item.source.pathId === pickup.provenance.selector.pathId);
      assert.ok(selected);
      assert.ok(Math.abs(pickup.distance / 0.1 - selected.nativeZ) < 1e-3);
    }
    unavailable += empty.length;
  }
  assert.deepEqual([...seen].sort(), ['doubleScore', 'magnet', 'sneakers']);
  assert.ok(emitted > 30 && unavailable > 10);
});

test('unsupported jetpack retains its source draw and threshold and reset reproduces the sequence', () => {
  const graph = Object.values(library.routes).find(graph => graph.nodes.some(node => node.scripts.some(script => script.class === 'SpawnPoint')));
  let seed;
  for (let candidate = 1; candidate < 200; candidate++) {
    const generator = new SourceRouteGenerator(library, { seed: candidate });
    const result = generator.compileChunk(graph.id, { startDistance: 300 });
    if (result.diagnostics.some(item => item.powerup === 'jetpack')) { seed = candidate; break; }
  }
  assert.ok(seed);
  const generator = new SourceRouteGenerator(library, { seed });
  const result = generator.compileChunk(graph.id, { startDistance: 300 });
  assert.ok(!result.entities.some(item => item.powerup === 'jetpack'));
  const enabled = new SourceRouteGenerator(library, { seed, enabledPowerups: ['jetpack'] }).compileChunk(graph.id, { startDistance: 300 });
  assert.deepEqual(enabled.decisions, result.decisions, 'effect support cannot change the random or lifecycle sequence');
  assert.ok(enabled.entities.some(item => item.powerup === 'jetpack'));
  generator.reset(seed);
  assert.deepEqual(generator.compileChunk(graph.id, { startDistance: 300 }), result);
});
