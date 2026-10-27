import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import fs from 'node:fs';
import { RunnerGame, sourceVerticalBounds } from '../src/game-core.js';
import { colliderBounds, colliderShape, SourceRouteGenerator } from '../src/route-generator.js';

function emptyGame() {
  const game = new RunnerGame({ acceleration: 0 });
  game.entities = []; game.nextSection = Infinity; game.start(); return game;
}
function run(game, seconds) { for (let i = 0; i < Math.round(seconds * 120); i++) game.advance(1 / 120); }

test('source rotated ramp uses its actual slope, not the maximum AABB height', () => {
  const fields = { m_Size: { x: 17, y: 42, z: 20 }, m_Center: { x: 0, y: 0, z: 0 } };
  const matrix = new Matrix4().compose(new Vector3(0, 11.294921875, -1.8470458984375), new Quaternion(0.5358268618583679, 0, 0, 0.8443279266357422), new Vector3(1, 1, 1));
  const box = colliderBounds(fields, matrix);
  box.sourceShape = colliderShape(fields, matrix, box);
  const low = sourceVerticalBounds(box, 0, -1.5), high = sourceVerticalBounds(box, 0, 1);
  assert.ok(high.top > low.top + 1);
  assert.ok(low.top < box.height - 1);
  assert.equal(sourceVerticalBounds(box, 4, 0), null);
});

test('source capsule top follows the curved cap and rejects points outside it', () => {
  const entity = { x: 0, distance: 0, sourceShape: { type: 'capsule', rows: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]], radius: 1, halfSegment: 1, axis: 1 } };
  assert.deepEqual(sourceVerticalBounds(entity, 0, 0), { bottom: -2, top: 2 });
  assert.ok(Math.abs(sourceVerticalBounds(entity, 0.8, 0).top - 1.6) < 1e-10);
  assert.equal(sourceVerticalBounds(entity, 1.1, 0), null);
});

test('moving train visuals and collision keep the same travel and swept impact', () => {
  const game = emptyGame();
  const train = game.addEntity({ type: 'train', lane: 1, distance: 15, width: 1.8, height: 3, depth: 3, velocityZ: 22, motionId: 'train-1' });
  const visual = game.addEntity({ type: 'decoration', lane: 1, distance: 15, velocityZ: 22, motionId: 'train-1' });
  let impactTime = 0;
  while (game.state.phase === 'running' && impactTime < .6) { game.advance(1 / 120); impactTime += 1 / 120; }
  assert.equal(game.state.phase, 'gameover');
  assert.equal(train.distance, visual.distance);
  assert.ok(impactTime < 0.5); // SaveMe now keeps elapsed time advancing after impact.
});

test('a source gap removes ground while jumping can cross a short opening', () => {
  const falling = emptyGame();
  falling.addEntity({ type: 'gap', lane: 1, distance: 10, width: 2, depth: 20, floor: false });
  run(falling, 1);
  assert.equal(falling.state.collision.type, 'gap');
  const jumping = emptyGame();
  jumping.addEntity({ type: 'gap', lane: 1, distance: 4, width: 2, depth: 2, floor: false });
  jumping.action('jump'); run(jumping, 1);
  assert.equal(jumping.state.phase, 'running');
  assert.equal(jumping.state.player.y, 0);
});

test('the actual recovered default ramp carries a runner through its capsule, tilted box and roof seam', () => {
  const library = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json', import.meta.url)));
  const generator = new SourceRouteGenerator(library);
  const id = generator.chunkIds.find(key => key.endsWith('/routechunk_default_ramp_1'));
  const chunk = generator.compileChunk(id, { startDistance: 10, speed: 11 });
  const game = emptyGame();
  for (const entity of chunk.entities) game.addEntity(entity);
  run(game, 2.3);
  assert.equal(game.state.phase, 'running');
  assert.ok(Math.abs(game.state.player.y - 2.92) < 0.02);
  run(game, 1.7);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.player.y, 0);
});
