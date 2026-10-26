import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sectionEligibility, recordSectionSpawn, SemiRandomlyOrderedList, shuffleSourceList, sourceWeightedPicker, SourceRouteGenerator } from '../src/route-generator.js';

test('native section gates honor inclusive distance boundaries and spawn-order offset', () => {
  const fields = { _zMinimum: 100, _zMaximumActive: true, _zMaximum: 500, _minSpawnOrder: 2, _repeatConfiguration: { _distanceBetweenRepeats: 90 } };
  const context = { z: 200, sectionCountUsed: 3, minimumRepeatDistance: 100 };
  assert.equal(sectionEligibility(fields, { lastSpawnZ: 100 }, context).allowed, true);
  assert.ok(sectionEligibility(fields, { lastSpawnZ: 100 }, { ...context, z: 199 }).reasons.includes('distance-between-repeats'));
  assert.ok(sectionEligibility(fields, {}, { ...context, sectionCountUsed: 2 }).reasons.includes('minimum-spawn-order'));
  assert.equal(sectionEligibility(fields, {}, { ...context, z: 500 }).allowed, true);
  assert.ok(sectionEligibility(fields, {}, { ...context, z: 501 }).reasons.includes('z-maximum'));
});

test('section spawn decrements all cooldowns then resets the selected section', () => {
  const states = new Map([['a', { sectionsRemaining: 2 }], ['b', { sectionsRemaining: 0 }], ['c', { sectionsRemaining: 1 }]]);
  recordSectionSpawn(states, 'b', { _repeatConfiguration: { _sectionsBetweenRepeats: 3 } }, 1800, 900);
  assert.equal(states.get('a').sectionsRemaining, 1);
  assert.equal(states.get('c').sectionsRemaining, 0);
  assert.deepEqual(states.get('b'), { sectionsRemaining: 3, lastSpawnZ: 2700 });
  assert.equal(sectionEligibility({}, states.get('b'), { z: 9999, sectionCountUsed: 100 }).allowed, false);
});

test('native shuffle is reverse Fisher–Yates and never draws for a singleton', () => {
  let draws = 0;
  const random = () => { draws++; return 0; };
  assert.deepEqual(shuffleSourceList([1, 2, 3, 4], random), [2, 3, 4, 1]);
  assert.equal(draws, 3);
  shuffleSourceList([1], random); assert.equal(draws, 3);
});

test('semi-random lists preserve duplicates and regenerate only at native thresholds', () => {
  const list = new SemiRandomlyOrderedList([1, 2, 3, 4, 5, 6, 7, 8], () => 0);
  assert.deepEqual(Array.from({ length: 4 }, () => list.getNext(() => 0)), [2, 3, 4, 5]);
  assert.equal(list.ready.length, 4); assert.equal(list.used.length, 4);
  assert.equal(list.getNext(() => 0), 6);
  assert.deepEqual(list.ready, [7, 8, 1, 3, 4, 5, 6, 2]);
  assert.deepEqual(list.used, []);
  const duplicated = new SemiRandomlyOrderedList(['a', 'a', 'b', 'b'], () => 0);
  const evaluated = [];
  assert.equal(duplicated.getNextMatching(() => 0, item => { evaluated.push(item); return false; }), null);
  assert.deepEqual(evaluated.sort(), ['a', 'b']);
  assert.equal(duplicated.ready.length, 4);
});

test('weighted source picker expands integer weights and its used fallback does not consume', () => {
  const a = { Prefab: { ref: 'a' }, Weight: 2 }, b = { Prefab: { ref: 'b' }, Weight: 1 }, zero = { Prefab: { ref: 'zero' }, Weight: 0 };
  const state = new Map();
  sourceWeightedPicker({ entries: [a, b, zero], evaluator: () => false, scope: 'pool', random: () => 0, state });
  const list = state.get('pool');
  assert.equal(list.all.length, 3); assert.equal(list.all.filter(item => item === a).length, 2);
  list.ready = [a, a]; list.used = [b];
  assert.equal(sourceWeightedPicker({ entries: [a, b], evaluator: item => item === b, scope: 'pool', random: () => 0, state }), b);
  assert.deepEqual(list.ready, [a, a]); assert.deepEqual(list.used, [b]);
});

test('real default section scheduling starts with its authored start pool and fully resets seed state', () => {
  const library = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json', import.meta.url)));
  const generator = new SourceRouteGenerator(library, { seed: 4901 });
  const sequence = () => {
    let startDistance = 0;
    return Array.from({ length: 40 }, () => {
      const chunk = generator.nextChunk({ startDistance, speed: 11, playerDistance: Math.max(0, startDistance - 140) });
      const summary = { id: chunk.provenance.chunkId, section: chunk.provenance.sectionId, startDistance, length: chunk.length, choices: chunk.decisions.filter(item => ['Randomizer', 'WeightedPick', 'Mirror'].includes(item.type)) };
      startDistance += chunk.length;
      return summary;
    });
  };
  const first = sequence();
  assert.match(first[0].id, /routechunk_default_start[12]$/);
  assert.equal(first[0].length, 36);
  assert.ok(new Set(first.map(chunk => chunk.section)).size > 5);
  generator.reset(4901);
  assert.deepEqual(sequence(), first);
});
