import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RunnerGame } from '../src/game-core.js';
import { PlayerMotion } from '../src/player-motion.js';
import { createCharacterAnimationController } from '../src/asset-adapter.js';

function setup() {
  const g = new RunnerGame({ acceleration: 0 }); g.entities = []; g.nextSection = 1e9; g.start();
  const durations = { run: .4, jump: .8, hangtime: .7, landing: .2, roll: .54, dodge_left: .5,
    board_takeoff: .8, board_jump: .08333396911621094, board_run: .4, board_roll: .54, flight: 1, flight_left: .5,
    flight_headstart: 1.6000003814697266 };
  const mixer = new THREE.AnimationMixer(new THREE.Group());
  const clips = Object.entries(durations).map(([name, duration]) => new THREE.AnimationClip(name, duration,
    [new THREE.NumberKeyframeTrack('.position[x]', [0, duration], [0, 1])]));
  const actor = { mixer, clipDurations: durations, ...createCharacterAnimationController(mixer, clips) };
  const motion = new PlayerMotion({ hangtime: ['hangtime'] });
  const select = () => {
    const pose = motion.select(g.state, g.drainEvents(), actor);
    actor.setAnimation(pose.name, pose.duration, pose.token ?? null, { fade: pose.fade });
    if (pose.speed != null) actor.setTimeScale(pose.speed);
    return pose;
  };
  return { g, actor, motion, select };
}

test('turbo headstart plays the full original one-shot and queues flight at .2 fade',()=>{
  const {g,actor,select}=setup();g.activateHeadstart();assert.equal(select().name,'flight');
  g.action('turbo');const pose=select();assert.equal(pose.name,'flight_headstart');assert.equal(pose.fade,Math.fround(.1));
  actor.mixer.update(1);assert.equal(select().name,'flight_headstart');
  actor.mixer.update(.61);const flight=select();assert.equal(flight.name,'flight');assert.equal(flight.fade,Math.fround(.2));
});

test('queued locomotion follows actual clip completion, not a simulation-clock deadline', () => {
  const { g, actor, select } = setup(); g.action('left'); const dodge = select();
  actor.mixer.update(.1); g.state.elapsed = 2;
  assert.equal(select().token, dodge.token, 'a slow mixer must not lose the unplayed dodge tail');
  actor.mixer.update(.4);
  assert.equal(select().name, 'run');
});

test('a sped-up short clip returns to run as soon as playback finishes and ignores stale generations', () => {
  const { g, actor, select } = setup(); g.action('left'); const first = select();
  actor.setTimeScale(4); actor.mixer.update(.13);
  assert.equal(select().name, 'run', 'the physics clock need not advance to .5');
  g.action('right'); g.action('left'); const next = select();
  assert.notEqual(next.token, first.token); assert.equal(next.name, 'dodge_left');
  actor.mixer.update(.05); assert.equal(select().token, next.token);
});

test('grounded board takeoff interrupts a dodge and never resurfaces after jump/roll', () => {
  const { g, actor, select } = setup(); g.action('left'); select(); actor.mixer.update(.05);
  g.action('board'); assert.equal(select().name, 'board_takeoff'); actor.mixer.update(.03);
  g.action('jump'); assert.equal(select().name, 'board_jump'); actor.mixer.update(.03);
  g.action('roll'); assert.equal(select().name, 'board_roll'); actor.mixer.update(.1);
  g.endRoll('clip-length'); g.state.player.grounded = true;
  assert.equal(select().name, 'board_run', 'interrupted takeoff is not a pending lower-priority pose');
});

test('airborne board activation samples event-time jumping/falling and goes straight to hangtime', () => {
  const { g, motion, actor, select } = setup(); g.action('jump'); select();
  g.action('board'); const events = g.drainEvents();
  assert.equal(events[0].motion.jumping, true);
  // Landing later in the same render interval cannot turn the earlier event
  // into a grounded takeoff. Land itself is processed in its original order.
  g.state.player.isJumping = false;
  const pose = motion.select(g.state, events, actor);
  assert.equal(pose.name, 'board_jump'); assert.equal(pose.fade, .2);
});

test('jetpack pickup interrupts a ground dodge and exit replaces a flight dodge immediately', () => {
  for (const board of [false, true]) {
    const { g, actor, select } = setup(); if (board) { g.action('board'); select(); }
    g.action('left'); select(); actor.mixer.update(.03);
    g.activatePowerup('jetpack'); assert.equal(select().name, 'flight');
    g.action('right'); g.action('left'); assert.equal(select().name, 'flight_left');
    g.state.distance = g.state.flight.targetZ + 1; g.state.player.y = 9.5;
    g.advance(1 / 120);
    assert.equal(g.state.flight, null);
    assert.equal(select().name, board ? 'board_jump' : 'hangtime');
  }
});

test('pause leaves a short action and its playback cursor unchanged', () => {
  const { g, actor, select } = setup(); g.action('left'); const pose = select(); actor.mixer.update(.1);
  g.pause(); for (let i = 0; i < 20; i++) { g.advance(.1); assert.equal(select().token, pose.token); }
  assert.equal(actor.getAnimationSnapshot().actions.find(a => a.name === 'dodge_left').time, .1);
});

test('protected moving-train jump plays before the delayed physical board recovery', () => {
  const { g, actor, select } = setup();g.action('board');select();actor.mixer.update(.05);
  g.addEntity({type:'train',lane:1,distance:1.1,width:2,depth:1,sourceTag:'HitMovingTrain'});
  for(let i=0;i<12;i++)g.advance(1/120);
  const hit=select();assert.equal(hit.name,'board_jump');assert.equal(hit.fade,Math.fround(.15));
  actor.mixer.update(.1);assert.equal(select().name,'board_jump','short source Jump holds until the actual recovery notification');
  assert.equal(g.state.player.grounded,true);assert.ok(g.state.board.crashPending);
  for(let i=0;i<24;i++)g.advance(1/120);
  const recovered=select();assert.equal(recovered.name,'jump');assert.equal(recovered.fade,0);
  assert.ok(g.state.player.velocityY>0);
});
