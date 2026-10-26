import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';

function course() {
  const game = new RunnerGame({ initialSpeed: 11, acceleration: 0 });
  game.entities = [];
  game.nextSection = 1e9;
  game.start();
  return game;
}

function runFor(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 120); i++) game.advance(1 / 120);
}

test('an adjoining ramp carries the runner onto a train roof', () => {
  const game = course();
  game.addEntity({ type: 'ramp', lane: 1, distance: 10, width: 1.8, height: 3, depth: 6 });
  game.addEntity({ type: 'train', lane: 1, distance: 18, width: 1.8, height: 3, depth: 10 });
  runFor(game, 1.6);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.player.y, 3);
  assert.equal(game.state.player.grounded, true);
});

test('the train front remains solid without a ramp', () => {
  const game = course();
  game.addEntity({ type: 'train', lane: 1, distance: 18, width: 1.8, height: 3, depth: 10 });
  runFor(game, 1.6);
  assert.equal(game.state.phase, 'gameover');
});

test('a runner can land on a roof, then fall after leaving the train', () => {
  const game = course();
  game.addEntity({ type: 'train', lane: 1, distance: 6, width: 1.8, height: 3, depth: 10 });
  Object.assign(game.state.player, { y: 4.5, velocityY: 0, grounded: false });
  runFor(game, 0.8);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.player.y, 3);
  runFor(game, 1.2);
  assert.equal(game.state.phase, 'running');
  assert.equal(game.state.player.y, 0);
});
