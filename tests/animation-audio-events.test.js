import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { AnimationAudioEvents } from '../src/animation-audio-events.js';
import { createCharacterAnimationController } from '../src/asset-adapter.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/classic-audio-events.json', import.meta.url)));
const snapshot = (name, time, extra = {}) => ({ actions: [{ name, time, duration: 10/24,
  generation: 1, loopCount: 0, enabled: true, weight: 1, paused: false, ...extra }] });

test('source footfalls follow clip time, including the loop boundary without duplicates', () => {
  const clock = new AnimationAudioEvents(data);
  assert.deepEqual(clock.sample(snapshot('run', 0)), []);
  assert.deepEqual(clock.sample(snapshot('run', 2/24)).map(e => e.binding), ['footstepLeft']);
  assert.deepEqual(clock.sample(snapshot('run', 7/24)).map(e => e.binding), ['footstepRight']);
  assert.deepEqual(clock.sample(snapshot('run', 2/24, {loopCount:1})).map(e => e.binding), ['footstepLeft']);
  assert.deepEqual(clock.sample(snapshot('run', 2/24, {loopCount:1})), []);
});

test('same-clip replay fires frame zero again, and supersneakers choose their source jump sound', () => {
  const clock = new AnimationAudioEvents(data);
  const first = clock.sample(snapshot('jump', .01), { sneakers: true });
  assert.ok(first.some(e => e.binding === 'superJump'));
  assert.ok(first.some(e => e.binding === 'groundLeft'));
  assert.equal(clock.sample(snapshot('jump', .02)).length, 0);
  assert.ok(clock.sample(snapshot('jump', .01, {generation:2})).some(e => e.binding === 'jump'));
});

test('paused and disabled actions do not play or replay stale audio', () => {
  const clock = new AnimationAudioEvents(data);
  clock.sample(snapshot('run', 0));
  assert.deepEqual(clock.sample(snapshot('run', .1), {paused:true}), []);
  assert.equal(clock.sample(snapshot('run', .1)).length, 1);
  assert.deepEqual(clock.sample(snapshot('run', .3, {enabled:false})), []);
  assert.deepEqual(clock.sample(snapshot('run', .31)), []);
});

test('paint sounds are confined to menu and use different source spray and shake frames', () => {
  const clock = new AnimationAudioEvents(data);
  assert.deepEqual(clock.sample(snapshot('idle_paint', 5/24, {duration:23.541666}), {phase:'ready'}).map(e => e.binding), ['idlePaintSpray']);
  assert.deepEqual(clock.sample(snapshot('idle_paint', 39/24, {duration:23.541666}), {phase:'ready'}).map(e => e.binding), ['idlePaintShake']);
  assert.deepEqual(clock.sample(snapshot('idle_paint', 115/24, {duration:23.541666}), {phase:'intro'}), []);
});

test('death sounds use recovered impact frames rather than the fatal-input instant', () => {
  const clock = new AnimationAudioEvents(data);
  assert.deepEqual(clock.sample(snapshot('death_moving_train', 0, {duration:2})), []);
  const event = data.events.death_moving_train[0];
  assert.equal(event.frame, 13);
  assert.equal(clock.sample(snapshot('death_moving_train', event.time+.001, {duration:2}))[0].binding, 'hitMovingTrain');
});

test('real mixer activation and loop snapshots feed the source audio clock', () => {
  const object = new THREE.Object3D(), mixer = new THREE.AnimationMixer(object);
  const makeClip = name => new THREE.AnimationClip(name, 10/24, [new THREE.NumberKeyframeTrack('.position[x]', [0,10/24], [0,0])]);
  const controller = createCharacterAnimationController(mixer, [makeClip('run'), makeClip('roll')]);
  const clock = new AnimationAudioEvents(data);
  controller.setAnimation('run'); mixer.update(.1);
  assert.deepEqual(clock.sample(controller.getAnimationSnapshot()).map(e => e.binding), ['footstepLeft']);
  mixer.update(.4);
  assert.deepEqual(clock.sample(controller.getAnimationSnapshot()).map(e => e.binding), ['footstepRight','footstepLeft']);
  controller.setAnimation('roll', undefined, 1, {fade:0}); mixer.update(.01);
  assert.ok(clock.sample(controller.getAnimationSnapshot()).some(e => e.binding === 'groundRight'));
  controller.setAnimation('roll', undefined, 2, {fade:0}); mixer.update(.01);
  assert.ok(clock.sample(controller.getAnimationSnapshot()).some(e => e.binding === 'groundRight'));
});

test('new game seeds outgoing clip time instead of replaying old jump events', () => {
  const clock = new AnimationAudioEvents(data), old = snapshot('jump', .2);
  assert.ok(clock.sample(old).some(event => event.binding === 'jump'));
  clock.reset(old);
  assert.deepEqual(clock.sample(snapshot('jump', .21, {weight:.4})), []);
  assert.ok(clock.sample(snapshot('jump', .01, {generation:2})).some(event => event.binding === 'jump'));
});
