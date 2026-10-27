import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassicCamera, CLASSIC_CAMERA, classicCameraFov, jetpackCameraBlend } from '../src/classic-camera.js';

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const step = (camera, overrides = {}, dt = 1 / 60) => camera.step(dt, { position: [0, 0, 0], ...overrides });

test('native camera offsets and ordinary aspect FOV are independent of speed ramp', () => {
  const camera = new ClassicCamera({ aspect: 16 / 9 });
  const s = step(camera, { position: [0, 0, 123] });
  assert.deepEqual(s.position, [0, 3.3, 119.7]);
  near(s.target[1], 2); near(s.target[2], 123); near(s.fov, 71);
  near(classicCameraFov(.5625).running, 40 / .5625);
  near(classicCameraFov(.5).menu, 80);
  near(classicCameraFov(16 / 9).menu, 74.57140350341797);
  near(classicCameraFov(1, .5).running, 40); // distinct screen and actual camera aspect
});

test('lane following converges to .75 x without direct x snapping', () => {
  const camera = new ClassicCamera();
  const first = step(camera, { position: [2, 0, 0] });
  assert.ok(first.position[0] > 0 && first.position[0] < 1.5);
  for (let i = 0; i < 120; i++) step(camera, { position: [2, 0, 0] });
  near(camera.snapshot().position[0], 1.5);
});

test('ordinary low jump stays level; high target clamp and actual roof grounding are separate', () => {
  const camera = new ClassicCamera();
  near(step(camera, { position: [0, 1.5, 0], grounded: false }).position[1], 3.3);
  // Native clamp prevents the target falling more than .5 below a very high character.
  near(step(camera, { position: [0, 4, 0], grounded: false }).sourceTarget[1], 3.5);
  for (let i = 0; i < 120; i++) step(camera, { position: [0, 2, 0], lastGroundedY: 2 });
  near(camera.snapshot().position[1], 5.3);
});

test('sneakers factor approaches .5 in air and resets transition only on a modifier change', () => {
  const camera = new ClassicCamera();
  const a = step(camera, { position: [0, 2, 0], grounded: false, sneakers: true }, .1);
  near(a.jumpFactor, .1); near(a.transitionTime, .1);
  const b = step(camera, { position: [0, 2, 0], grounded: false, sneakers: true }, .1);
  near(b.jumpFactor, .18); near(b.transitionTime, .2);
  const c = step(camera, { position: [0, 0, 0], sneakers: true });
  near(c.jumpFactor, .5);
});

test('grounded jumper board uses the same .5 factor and ordinary board does not imply a modifier', () => {
  const camera = new ClassicCamera();
  near(step(camera, { jumperBoard: true }).jumpFactor, .5);
  near(step(camera).jumpFactor, 0);
  near(step(camera, { doubleJumping: true, jumpingHigher: true }).jumpFactor, CLASSIC_CAMERA.doubleJumpHigherFactor);
});

test('vector smoothing has source .005 minimum dt; z remains immediate', () => {
  const a = new ClassicCamera(), b = new ClassicCamera();
  const one = step(a, { position: [2, 0, 9] }, .001);
  const two = step(b, { position: [2, 0, 9] }, CLASSIC_CAMERA.minVectorDeltaTime);
  near(one.position[0], two.position[0]); near(one.position[2], 5.7);
});

test('intro-to-running keeps prior height and pitch then independently blends to follow pose', () => {
  const camera = new ClassicCamera();
  camera.setPose({ position: [0, 8, -4], target: [0, 7, 0], fov: 76 });
  const prior = camera.snapshot(); camera.enterRunning();
  const first = step(camera, {}, .25);
  near(first.position[1], 8); near(first.pitchDegrees, prior.pitchDegrees); near(first.fov, 76);
  const half = step(camera, {}, .25);
  near(half.position[1], (8 + half.sourcePosition[1]) / 2);
  const last = step(camera);
  near(last.position[1], last.sourcePosition[1]);
});

test('disabled camera preserves source animation/death pose and does not consume camera time', () => {
  const camera = new ClassicCamera();
  camera.setPose({ position: [1, 7, -5], target: [0, 2, 0], fov: 74 });
  const before = camera.snapshot();
  assert.deepEqual(step(camera, { enabled: false, position: [10, 50, 100] }, 2), before);
});

test('subway camera ceiling clamps position; target and final transition remain independent', () => {
  const camera = new ClassicCamera();
  const s = step(camera, { insideSubway: true, subwayMaxY: 2.8 });
  near(s.position[1], 2.8); near(s.sourceTarget[1], 2);
});

test('modifier adds half delta to target and full extra delta to camera, exits at exact endpoint', () => {
  const camera = new ClassicCamera();
  camera.enterCameraModifier({ startZ: 0, length: 10, evaluateCurve: () => -1 });
  const s = step(camera, { position: [0, 0, 5] });
  near(s.sourceTarget[1], 1.5); near(s.position[1], 1.8);
  near(step(camera, { position: [0, 0, 10] }).position[1], 3.3);
  camera.enterCameraModifier({ startZ: 0, length: 25.2 });
  near(step(camera, { position: [0, 0, 12.6] }).position[1], 1.8);
});

test('ordinary jetpack source camera curve preserves starting pose and uses .9 lateral target with one frame delay', () => {
  const camera = new ClassicCamera({ aspect: 16 / 9 });
  const initial = camera.snapshot();
  const jetpack = { active: true, takingOff: true, startDistance: 0, takeoffDistance: 33, levelSpeed: 11 };
  const start = step(camera, { jetpack });
  assert.deepEqual(start.position, initial.position); near(start.fov, 71);
  const first = step(camera, { position: [2, 9.5, 33], jetpack: { ...jetpack, takingOff: false } });
  near(first.position[0], 0);
  for (let i = 0; i < 120; i++) step(camera, { position: [2, 9.5, 33], jetpack: { ...jetpack, takingOff: false } });
  const cruise = camera.snapshot();
  near(cruise.position[0], 2 * CLASSIC_CAMERA.jetpackModifierX);
  near(cruise.position[1], 12.8); near(cruise.position[2], 29.7);
  near(cruise.target[1], 11.5); near(cruise.fov, 71);
  const exit = step(camera, { position: [2, 9.5, 33], grounded: false });
  near(exit.position[1], cruise.position[1]); assert.equal(exit.mode, 'running');
});

test('jetpack authored curve starts clamped at zero and finishes clamped at one', () => {
  near(jetpackCameraBlend(0), 0); near(jetpackCameraBlend(1), 1);
  near(jetpackCameraBlend(.21918271481990814), .7289865016937256);
});

test('shake shifts camera and look target equally after orientation, then resets', () => {
  const camera = new ClassicCamera(); const before = step(camera);
  camera.startShake();
  const shaken = step(camera, { shakeSample: [1, 0, 0] }, .1);
  near(shaken.position[0] - before.position[0], 1);
  near(shaken.target[0] - before.target[0], 1);
  near(shaken.pitchDegrees, before.pitchDegrees);
  camera.resetShake(); near(step(camera).position[0], 0);
});
