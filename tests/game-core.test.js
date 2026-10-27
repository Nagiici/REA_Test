import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';

function emptyGame() {
  const game = new RunnerGame({ acceleration: 0 });
  game.entities = [];
  game.nextSection = 1e9;
  game.start();
  return game;
}

function frames(game, seconds, hz = 60) {
  for (let i = 0; i < seconds * hz; i++) game.advance(1 / hz);
}

test('simulation produces the same result across rendering frame rates', () => {
  const a = emptyGame(), b = emptyGame();
  a.action('left'); b.action('left');
  a.action('jump'); b.action('jump');
  frames(a, 3, 30); frames(b, 3, 120);
  assert.ok(Math.abs(a.state.distance - b.state.distance) < 1e-8);
  assert.equal(a.state.player.y, b.state.player.y);
  assert.equal(a.state.player.x, b.state.player.x);
});

test('standing collides with low barrier, timed jump clears it', () => {
  const standing = emptyGame(), jumping = emptyGame();
  for (const g of [standing, jumping]) g.addEntity({ type: 'barrier', lane: 1, distance: 6 });
  jumping.action('jump');
  frames(standing, 1); frames(jumping, 1);
  assert.equal(standing.state.phase, 'gameover');
  assert.equal(jumping.state.phase, 'running');
});

test('overhead barrier requires a roll or another lane', () => {
  const a = emptyGame(), b = emptyGame();
  for (const g of [a, b]) g.addEntity({ type: 'overhead', lane: 1, distance: 5 });
  b.action('roll');
  frames(a, 0.6); frames(b, 0.6);
  assert.equal(a.state.phase, 'gameover');
  assert.equal(b.state.phase, 'running');
});

test('a coin is counted once, pause freezes progress, and restart resets score', () => {
  const g = emptyGame();
  g.addEntity({ type: 'coin', lane: 1, distance: 2, y: 1 });
  frames(g, 0.5);
  assert.equal(g.state.coins, 1);
  g.pause(); const distance = g.state.distance;
  frames(g, 2);
  assert.equal(g.state.distance, distance);
  g.reset();
  assert.equal(g.state.coins, 0);
  assert.equal(g.state.score, 0);
  assert.equal(g.state.phase, 'ready');
});

test('lane commands stay within three tracks and air jumps are rejected', () => {
  const g = emptyGame();
  g.action('left');
  assert.equal(g.action('left'), false); // First boundary impact now causes a source stumble.
  frames(g, 0.3);
  assert.equal(g.state.player.lane, 0);
  assert.equal(g.state.player.x, -g.config.laneSpacing);
  assert.equal(g.action('jump'), true);
  assert.equal(g.action('jump'), false);
});

test('reversing a partly completed lane change is continuous and takes proportional time', () => {
  const game = emptyGame();
  game.action('left');
  frames(game, 0.1);
  const x = game.state.player.x;
  assert.ok(x < 0 && x > -game.config.laneSpacing);
  game.action('right');
  assert.equal(game.state.player.x, x);
  frames(game, 0.1);
  assert.ok(Math.abs(game.state.player.x) < 1e-8);
  assert.equal(game.state.player.lane, 1);
});

test('a recovered section keeps source offsets and dimensions', () => {
  const route = { length: 72, source: 'test-source-route', entities: [{ type: 'train', x: -2, distance: 12, width: 1.85, height: 3, depth: 6 }] };
  const game = new RunnerGame({}, [route]);
  assert.equal(game.entities[0].distance, 40);
  assert.equal(game.entities[1].distance - game.entities[0].distance, 72);
  assert.equal(game.entities[0].source, route.source);
  assert.equal(game.entities[0].depth, 6);
});
