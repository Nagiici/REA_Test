import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceRouteGenerator, initializeCoinCurve, evaluateUnityCurve } from '../src/route-generator.js';
import { RunnerGame } from '../src/game-core.js';

test('CoinCurve initialization linearizes only Z, retaining the authored X/Y curves', () => {
  const xy = { keys: [{ time: 0, value: 0, outSlope: 4 }, { time: 1, value: 0, inSlope: -4 }] };
  const source = { curveX: xy, curveY: xy, curveZ: { keys: [{ time: 0, value: 0, outSlope: 0 }, { time: 1, value: 10, inSlope: 0 }] }, _minTime: 0, _maxTime: 1 };
  const runtime = initializeCoinCurve(source);
  assert.equal(runtime.curveX, xy); assert.equal(runtime.curveY, xy);
  assert.equal(evaluateUnityCurve(runtime.curveZ, 0.25), 2.5);
  assert.equal(evaluateUnityCurve(source.curveZ, 0.25), 1.5625);
});

test('actual source coins stay fixed during classic acceleration and reposition only for the explicit speed event', () => {
  const library = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json', import.meta.url)));
  const generator = new SourceRouteGenerator(library);
  const id = generator.chunkIds.find(key => key.endsWith('/routechunk_default_train_tops_1'));
  const chunk = generator.compileChunk(id, { startDistance: 100, speed: 11 });
  const sample = chunk.entities.find(entity => entity.coinCurve?.rule.fields._scaleMode === 1 && entity.coinCurve.rule.count > 2 && entity.coinCurve.rule.fields._coinIndexToSkip === -1 && !entity.movingTrain);
  assert.ok(sample);
  const rule = sample.coinCurve.rule;
  const game = new RunnerGame(); game.entities = []; game.nextSection = Infinity;
  for (const entity of chunk.entities.filter(entity => entity.type === 'coin')) game.addEntity(entity);
  const group = game.entities.filter(entity => entity.coinCurve.rule === rule);
  const before = group.map(entity => entity.distance);
  game.start(); for (let i = 0; i < 120; i++) game.advance(1 / 120);
  assert.ok(game.state.speed > 11);
  assert.deepEqual(group.map(entity => entity.distance), before);

  const count = game.entities.length, ids = game.entities.map(entity => entity.id);
  generator.onSpeedChanged(game.entities, 22, game.state.distance);
  assert.equal(game.entities.length, count);
  assert.deepEqual(game.entities.map(entity => entity.id), ids);
  assert.notDeepEqual(group.map(entity => entity.distance), before);
  const last = group.at(-1);
  const expectedLast = (rule.start[2] + (rule.end[2] - rule.start[2]) * (1 - rule.fields._curveOffset) * 2) * 0.1;
  assert.ok(Math.abs(last.distance - expectedLast) < 1e-8);

  // Native repositioning uses the current placed-list length to retain the
  // geometric offset after its leading coins have been removed.
  const remaining = game.entities.filter(entity => !group.slice(0, 2).includes(entity));
  const countRemaining = remaining.length;
  generator.onSpeedChanged(remaining, 16.5, game.state.distance);
  const expectedFirst = (rule.start[2] + (rule.end[2] - rule.start[2]) * (2 / (rule.count - 1) - rule.fields._curveOffset) * 1.5) * 0.1;
  assert.equal(remaining.length, countRemaining);
  assert.ok(Math.abs(group[2].distance - expectedFirst) < 1e-8);
});
