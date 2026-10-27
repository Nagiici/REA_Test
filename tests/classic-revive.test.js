import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassicRevive, CLASSIC_REVIVE_SOURCE as SOURCE } from '../src/classic-revive.js';

test('local demo credit is explicit and a source eight-second offer expires exactly once', () => {
  const revive = new ClassicRevive();
  assert.equal(revive.state.credits, 1);
  assert.equal(revive.offer(), true);
  assert.equal(revive.offer(), false);
  assert.deepEqual(revive.step(7.99), []);
  assert.equal(revive.state.phase, 'offered');
  assert.deepEqual(revive.step(.01), [{ type: 'offer-expired' }]);
  assert.equal(revive.accept(), false);
  assert.deepEqual(revive.step(100), []);
  assert.equal(revive.state.credits, 1, 'unused demo credit is not spent by timeout');
  assert.equal(revive.offer(), false, 'expired run cannot reopen its offer');
});

test('accepting consumes one local credit and resumes only after the recovered particle delay', () => {
  const revive = new ClassicRevive();
  revive.offer();
  revive.step(5);
  assert.equal(revive.accept(), true);
  assert.equal(revive.accept(), false);
  assert.equal(revive.decline(), false);
  assert.equal(revive.state.credits, 0);
  assert.equal(revive.state.used, 1);
  assert.deepEqual(revive.step(.1), []);
  assert.deepEqual(revive.step(SOURCE.delaySeconds - .1), [{ type: 'resume', clearDistanceNative: 250, jumpHeightNative: 15 }]);
  assert.equal(revive.state.phase, 'resumed');
  assert.deepEqual(revive.step(1), []);
  assert.equal(revive.offer(), false, 'default demo allowance is once per run');
});

test('pause freezes the offer and particle delay; decline bypasses the resume event', () => {
  const revive = new ClassicRevive();
  revive.offer();
  revive.step(20, { paused: true });
  assert.equal(revive.state.offerRemaining, 8);
  assert.equal(revive.decline(), true);
  assert.equal(revive.accept(), false);
  assert.deepEqual(revive.step(20), []);
  revive.reset();
  revive.offer(); revive.accept();
  revive.step(20, { paused: true });
  assert.equal(revive.state.delayRemaining, SOURCE.delaySeconds);
  assert.equal(revive.state.phase, 'reviving');
});

test('additional demo credits must be explicitly configured; only a new run reset replenishes them', () => {
  assert.equal(new ClassicRevive({ localCredits: 0 }).offer(), false);
  const revive = new ClassicRevive({ localCredits: 2 });
  for (let i = 0; i < 2; i++) {
    assert.equal(revive.offer(), true);
    revive.accept(); revive.step(SOURCE.delaySeconds);
  }
  assert.equal(revive.offer(), false);
  assert.equal(revive.state.used, 2);
  revive.reset();
  assert.equal(revive.state.credits, 2);
  assert.equal(revive.state.used, 0);
  assert.equal(revive.state.phase, 'idle');
});
