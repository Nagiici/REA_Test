import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChaserPresentation } from '../src/chaser-presentation.js';

function fixture() {
  const calls = [], updates = [];
  const actor = { object: new THREE.Group(), animationNames: ['run', 'guard_intro'],
    clipDurations: { guard_intro: 1.1600000858306885 },
    setAnimation: (...args) => calls.push(args), setTimeScale() {},
    mixer: { update: dt => updates.push(dt) } };
  actor.object.position.x = -.28; // Preserve replacement model's appearance fit.
  const state = { phase: 'intro', intro: { elapsed: 0, duration: 1.2083332538604736 },
    player: { x: 0, y: 0, lastGroundedY: 0 }, speed: 11,
    stumble: { guardDistanceNative: 10 }, flight: null };
  const view = createChaserPresentation({ guard: actor });
  return { actor, state, view, calls, updates };
}

test('intro shows only the existing replacement at the converted source root position', () => {
  const { actor, state, view, calls } = fixture();
  view.update(state, 0);
  assert.equal(view.object.visible, true);
  assert.equal(view.object.children.length, 1);
  assert.deepEqual(view.object.position.toArray(), [0, 0, 1]);
  assert.equal(actor.object.position.x, -.28);
  assert.equal(calls[0][0], 'guard_intro');
  assert.equal(calls[0][3].fade, 0);
});

test('intro preserves the cached source guard child anchor separately from replacement body fit', () => {
  const { actor, state } = fixture();
  const view = createChaserPresentation({ guard: actor }, { sourceActors: { guard: {
    rootTransform: { position: [-1.4279975891113281, 0, 0] },
  } } });
  view.update(state, 0);
  assert.equal(view.object.position.x, -1.4279975891113281 * .1);
  assert.equal(view.object.position.z, 1);
  assert.equal(actor.object.position.x, -.28);
  state.phase = 'running'; view.update(state, 0);
  assert.equal(view.object.position.x, state.player.x);
});

test('guard intro follows source elapsed time and queues run before player intro finishes', () => {
  const { state, view, calls, updates } = fixture();
  view.update(state, 0);
  state.intro.elapsed = .5; view.update(state, .5);
  assert.equal(calls.at(-1)[0], 'guard_intro');
  state.intro.elapsed = state.intro.duration; view.update(state, .7083332538604736);
  assert.equal(calls.at(-1)[0], 'run');
  assert.equal(calls.at(-1)[3].fade, .2);
  assert.ok(Math.abs(updates.reduce((a, b) => a + b, 0) - state.intro.duration) < 1e-12);
  assert.equal(view.object.visible, true);
});

test('paused intro freezes actor sampling; entering running resets independent following height', () => {
  const { state, view, calls, updates } = fixture();
  state.intro.elapsed = .4; view.update(state, .4);
  const before = [calls.length, updates.length];
  state.phase = 'paused'; state.pausedFrom = 'intro'; view.update(state, 10);
  assert.deepEqual([calls.length, updates.length], before);
  state.phase = 'running'; state.player.y = 2; state.player.lastGroundedY = .3;
  view.update(state, 0);
  assert.equal(view.object.position.y, .3);
  assert.equal(view.object.position.z, 1);
  assert.equal(calls.at(-1)[0], 'run');
});
