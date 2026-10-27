import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceClassicIntro, sampleIntroFov } from '../src/classic-intro.js';

// Synthetic timing/camera fixture: production reads the recovered player clip
// (1.2083332538604736 s), not the guard's shorter 1.1600000858306885 s clip.
const options = { introDuration: 1.16, startFov: 60, runningFov: 40, aspect: 0.5 };

test('classic startup emits the source cue order and does not enable gameplay input', () => {
  const intro = new SourceClassicIntro(options);
  assert.equal(intro.sample().phase, 'menu');
  const started = intro.begin();
  assert.deepEqual(started.events.map(e => e.type),
    ['stage-menu', 'guard-intro', 'camera-intro', 'player-intro', 'intro-run']);
  assert.equal(started.events[2].animation, 'startPan');
  assert.equal(started.events[3].index, 0);
  assert.equal(started.allowInput, false);
  assert.equal(intro.begin().started, false);
  assert.deepEqual(intro.begin().events, []);
});

test('the supplied player clip length ends the intro once and unlocks input without a countdown', () => {
  const intro = new SourceClassicIntro({ ...options, introDuration: 2.375 });
  intro.begin();
  assert.equal(intro.step(1.16).allowInput, false);
  assert.equal(intro.step(1).allowInput, false);
  const finish = intro.step(0.3);
  assert.equal(finish.elapsed, 2.375);
  assert.equal(finish.finished, true);
  assert.equal(finish.allowInput, true);
  assert.deepEqual(finish.events, [{ type: 'running', resetStats: true,
    guardFollowEnabled: true, allowInput: true }]);
  assert.equal(intro.step(1).finished, false);
  assert.deepEqual(intro.step(1).events, []);
});

test('FOV uses elapsed *.75 then forces its target at completion of a shorter intro', () => {
  const intro = new SourceClassicIntro(options);
  intro.begin();
  assert.equal(intro.step(1).cameraFov, 75);
  assert.ok(sampleIntroFov(1.16, options) < 80);
  const done = intro.step(0.2);
  assert.equal(done.cameraFov, 80);
  assert.equal(done.finished, true);
  assert.equal(sampleIntroFov(9, options), 80);
});

test('pause freezes intro animation/FOV time and does not unlock controls', () => {
  const intro = new SourceClassicIntro(options);
  intro.begin();
  intro.step(0.5);
  const before = intro.sample();
  const paused = intro.step(10, { paused: true });
  assert.equal(paused.elapsed, before.elapsed);
  assert.equal(paused.cameraFov, before.cameraFov);
  assert.equal(paused.allowInput, false);
  assert.equal(paused.finished, false);
});

test('returning to menu allows a new independent intro and snapshots camera inputs', () => {
  const input = { ...options };
  const intro = new SourceClassicIntro(input);
  input.aspect = 2;
  intro.begin();
  assert.equal(intro.step(10).cameraFov, 80);
  intro.reset();
  assert.equal(intro.sample().elapsed, 0);
  assert.equal(intro.sample().cameraFov, 60);
  assert.equal(intro.begin().started, true);
});

test('missing source duration and non-finite timing inputs fail explicitly', () => {
  assert.throws(() => new SourceClassicIntro({ ...options, introDuration: undefined }), RangeError);
  assert.throws(() => new SourceClassicIntro({ ...options, introDuration: 0 }), RangeError);
  assert.throws(() => new SourceClassicIntro({ ...options, aspect: 0 }), RangeError);
  const intro = new SourceClassicIntro(options);
  assert.throws(() => intro.step(NaN), RangeError);
  assert.throws(() => intro.step(-1), RangeError);
});
