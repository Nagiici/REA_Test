import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RunnerGame } from '../src/game-core.js';
import { PlayerMotion } from '../src/player-motion.js';
import { createCharacterAnimationController } from '../src/asset-adapter.js';
import { CLASSIC_MOTION_SOURCE as SOURCE, runningTransitionFromHeight, rollVerticalSpeed,
  movingTrainPresentation, SourceGuardVisibility } from '../src/classic-motion.js';

const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function game() {
  const g = new RunnerGame({ acceleration:0 }); g.entities=[]; g.nextSection=1e9; g.start(); return g;
}
function actor() {
  const durations = { run: .4, roll:.54, jump:1, hangtime:.8, landing:.6, dodge_left:.5,
    dodge_right:.5, board_roll:.54, board_run:.4, board_jump:1, stumble_mix:.8, death_moving_train:1 };
  const mixer = new THREE.AnimationMixer(new THREE.Group());
  const clips = Object.entries(durations).map(([name,duration]) => new THREE.AnimationClip(name,duration,
    [new THREE.NumberKeyframeTrack('.position[x]',[0,duration/2,duration],[0,1,0])]));
  return { mixer, clipDurations:durations, ...createCharacterAnimationController(mixer,clips) };
}
function setup() {
  const g=game(), a=actor(), motion=new PlayerMotion();
  const frame=(dt=1/120) => {
    g.advance(dt); const result=motion.select(g.state,g.drainEvents(),a);
    a.setAnimation(result.name,result.duration,result.token??null,{fade:result.fade});
    if(result.speed!=null)a.setTimeScale(result.speed);
    if(g.state.phase!=='paused')a.mixer.update(dt);
    g.updateAnimationState(a.getAnimationSnapshot()); return result;
  };
  return {g,a,motion,frame};
}

test('roll remains active through an actual mixer fade, then ends at the next fixed step',()=>{
  const {g,a,frame}=setup(); g.action('roll'); frame();
  for(let i=0;i<6;i++)frame();
  g.action('right'); frame();
  for(let i=0;i<10;i++)frame();
  assert.equal(a.getAnimationSnapshot().roll.enabled,true);
  assert.ok(g.state.player.rollRemaining>0);
  for(let i=0;i<17;i++)frame();
  assert.equal(a.getAnimationSnapshot().roll.enabled,false);
  assert.equal(g.state.player.rollRemaining,0);
  assert.ok(g.state.elapsed<.54);
  assert.equal(g.action('roll'),true);
  assert.equal(frame().name,'roll');
  assert.equal(a.getAnimationSnapshot().roll.token,2);
});

test('roll feedback is token-scoped, pause-safe and consumed once by the fixed simulation',()=>{
  const g=game();g.action('roll');g.drainEvents();
  g.updateAnimationState({roll:{token:0,enabled:false,rawLength:.54}});
  g.advance(1/120);assert.ok(g.state.player.rollRemaining>0);
  g.updateAnimationState({roll:{token:1,enabled:false,rawLength:.54}});
  assert.ok(g.state.player.rollRemaining>0,'feedback cannot mutate outside a fixed step');
  g.pause();g.advance(.1);assert.ok(g.state.player.rollRemaining>0);
  g.pause();g.advance(1/120);assert.equal(g.state.player.rollRemaining,0);
  assert.deepEqual(g.drainEvents().filter(e=>e.type==='roll-end').map(e=>e.reason),['animation-disabled']);
  g.action('roll');g.updateAnimationState({roll:{token:1,enabled:false}});g.advance(1/120);
  assert.ok(g.state.player.rollRemaining>0);assert.equal(g.state.player.rollToken,2);
});

test('raw roll length caps fast playback and repeating input cannot hold a frozen pose',()=>{
  const {g,a,frame}=setup();g.action('roll');frame();a.setTimeScale(4);
  for(let i=0;i<30;i++) { g.action('roll'); frame(); }
  assert.equal(g.state.player.rollToken,1);assert.ok(g.state.player.rollRemaining>0);
  assert.ok(a.getAnimationSnapshot().actions.find(x=>x.name==='roll').loopCount>=1);
  for(let i=0;i<40;i++)frame();
  assert.equal(g.state.player.rollRemaining,0);assert.equal(g.action('roll'),true);
  frame();const roll=a.getAnimationSnapshot().actions.find(x=>x.name==='roll');
  assert.equal(roll.loopCount,0);assert.ok(roll.enabled);near(roll.effectiveTimeScale,1);
});

test('snapshots retain outgoing action generations and reset loop counters on replay',()=>{
  const a=actor();a.setAnimation('run');a.mixer.update(.45);
  let run=a.getAnimationSnapshot().actions.find(x=>x.name==='run');
  assert.equal(run.loopCount,1);const first=run.activation;
  a.setAnimation('roll',undefined,7);a.mixer.update(.02);
  let snapshot=a.getAnimationSnapshot();run=snapshot.actions.find(x=>x.name==='run');
  assert.equal(run.activation,first);assert.ok(run.weight>0);
  assert.equal(snapshot.roll.token,7);
  a.setAnimation('run',undefined,8);snapshot=a.getAnimationSnapshot();
  run=snapshot.actions.find(x=>x.name==='run');
  assert.ok(run.activation>first);assert.equal(run.loopCount,0);assert.equal(run.token,8);
  assert.equal(snapshot.roll.token,7,'outgoing roll slot persists');
  snapshot.actions[0].time=999;assert.notEqual(a.getAnimationSnapshot().actions[0].time,999);
});

test('rapid three-way crossfades preserve outgoing weights without resurrecting an older pose',()=>{
  const a=actor();a.setAnimation('run',undefined,null,{fade:0});a.mixer.update(.01);
  a.setAnimation('roll',undefined,1,{fade:.2});a.mixer.update(.05);
  const before=a.getAnimationSnapshot();
  a.setAnimation('jump',undefined,2,{fade:.15});a.mixer.update(0);
  for(const name of ['run','roll'])near(a.getAnimationSnapshot().actions.find(x=>x.name===name).weight,
    before.actions.find(x=>x.name===name).weight);
  a.mixer.update(.075);
  const weights=a.getAnimationSnapshot().actions.filter(x=>x.active).map(x=>x.weight);
  assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-7); // Three interpolant samples are float32.
});

test('event-time ground state prevents an airborne lane event from replacing landing/jump state',()=>{
  const g=game(), a=actor(), m=new PlayerMotion();
  g.action('jump');m.select(g.state,g.drainEvents(),a);
  g.action('right');const lane=g.drainEvents();assert.equal(lane[0].motion.grounded,false);
  g.state.player.grounded=true;g.state.player.isJumping=false;
  assert.notEqual(m.select(g.state,lane,a).name,'dodge_right');
  const h=game(), n=new PlayerMotion();h.action('right');h.action('jump');
  assert.equal(n.select(h.state,h.drainEvents(),a).name,'jump');
});

test('jump interrupts roll immediately and a stale stumble cannot mask a later jump or roll',()=>{
  const {g,frame}=setup();g.stumble();assert.equal(frame().name,'stumble_mix');
  assert.ok(g.state.reaction);g.action('roll');assert.equal(frame().name,'roll');
  assert.equal(g.action('jump'),true);assert.equal(g.state.player.rollRemaining,0);
  assert.equal(frame().name,'jump');assert.ok(g.state.reaction,'logical stumble timer still exists');
});

test('landing while rolling leaves the roll intact; grounded roll queues the correct run fade',()=>{
  for(const board of [false,true]) {
    const g=game(), a=actor(), m=new PlayerMotion();if(board)g.action('board');
    g.action('roll');const first=m.select(g.state,g.drainEvents(),a);
    assert.equal(first.name,board?'board_roll':'roll');
    const still=m.select(g.state,[{type:'land',velocityY:-20,rolling:true}],a);
    assert.equal(still.name,first.name);assert.equal(still.token,first.token);
    g.endRoll('clip-length');const result=m.select(g.state,g.drainEvents(),a);
    // A pending board takeoff pose is independent; bypass it after its clip.
    g.state.elapsed=1;
    const run=m.select(g.state,[],a);
    assert.equal(run.name,board?'board_run':'run');
    near(run.fade,board?SOURCE.boardRollToRunFade:SOURCE.rollToRunFade);
  }
});

test('Running entry selects strict height bounds and high-transition roll ends on landing',()=>{
  assert.deepEqual([70,70.01,95,124.99,125].map(runningTransitionFromHeight),[false,true,true,true,false]);
  const g=game(), p=g.state.player;p.y=9.5;p.grounded=false;
  g.enterRunningFromHeight();assert.equal(p.transitionFromHeight,true);assert.equal(p.lastGroundedY,9.5);
  g.action('roll');assert.equal(p.velocityY,-25);
  for(let i=0;i<100;i++)g.advance(1/120);
  assert.equal(p.grounded,true);assert.equal(p.transitionFromHeight,false);
  g.action('roll');near(p.velocityY,-Math.sqrt(80));
  near(rollVerticalSpeed({transitionFromHeight:true,routeRelativeHeightNative:200}),-250);
  near(rollVerticalSpeed({transitionFromHeight:true,routeRelativeHeightNative:201}),-Math.sqrt(2*200*201));
});

test('real jetpack exit enters the height transition; ordinary jump height alone never does',()=>{
  const {g}=setup();g.activatePowerup('jetpack');
  for(let i=0;i<2500&&g.state.flight;i++)g.advance(1/120);
  assert.equal(g.state.flight,null);assert.equal(g.state.player.transitionFromHeight,true);
  g.action('roll');assert.equal(g.state.player.velocityY,-25);
  const h=game();h.state.player.y=9.5;h.state.player.grounded=false;h.action('roll');
  near(h.state.player.velocityY,-Math.sqrt(80));
});

test('moving-train camera tween and explicitly gated sink preserve source axes and order',()=>{
  const args={startPosition:[2,1,60],cameraPosition:[1,4,55]};
  assert.deepEqual(movingTrainPresentation({...args,elapsed:0}).position,[2,1,60]);
  const half=movingTrainPresentation({...args,elapsed:.25});
  near(half.position[0],1.5);near(half.position[1],.85);near(half.position[2],60);
  near(movingTrainPresentation({...args,elapsed:2}).position[1],.7);
  near(movingTrainPresentation({...args,elapsed:1.1,guardSequence:true}).position[1],.1);
  assert.deepEqual(movingTrainPresentation({...args,elapsed:2,guardSequence:true}).position,[1,-.5,60]);
  assert.deepEqual(movingTrainPresentation({...args,elapsed:2,guardSequence:true,guardSinkStartPosition:[3,2,65]}).position,[3,-.5,65]);
});

test('guard source visibility persists through retreat and hides only after its three-second wait',()=>{
  const guard=new SourceGuardVisibility();assert.equal(guard.isShowing,false);
  guard.beginIntro();assert.equal(guard.isShowing,true);assert.equal(guard.closeToCharacter,true);
  guard.resetCatchUp();near(guard.hideRemaining,3);
  guard.step(1.5);assert.equal(guard.isShowing,true,'maximum distance is not a hide condition');
  guard.resetCatchUp();near(guard.hideRemaining,1.5,'a duplicate reset cannot extend the wait');
  guard.step(1.499);assert.equal(guard.isShowing,true);
  guard.step(.001);assert.equal(guard.isShowing,false);assert.equal(guard.hideRemaining,null);
});

test('new catch-up cancels the hide coroutine and reset immediately hides',()=>{
  const guard=new SourceGuardVisibility();guard.catchUp();guard.resetCatchUp();guard.step(2);
  guard.catchUp();assert.equal(guard.hideRemaining,null);
  guard.step(10);assert.equal(guard.isShowing,true);
  guard.reset();assert.deepEqual(guard.snapshot(),{isShowing:false,closeToCharacter:false,hideRemaining:null});
});

test('guard hide wait freezes on pause; expiry during death is consumed without hiding',()=>{
  const guard=new SourceGuardVisibility();guard.beginIntro();guard.resetCatchUp();
  guard.step(10,{paused:true});near(guard.hideRemaining,3);assert.equal(guard.isShowing,true);
  guard.step(3,{dead:true});assert.equal(guard.isShowing,true);assert.equal(guard.hideRemaining,null);
  guard.step(5,{dead:false});assert.equal(guard.isShowing,true,'the completed coroutine cannot hide on a later frame');
});

test('authoritative guardClose transitions drive visibility without distance or opacity guesses',()=>{
  const guard=new SourceGuardVisibility();guard.step(.1,{guardClose:true});assert.equal(guard.isShowing,true);
  guard.step(.1,{guardClose:false});near(guard.hideRemaining,2.9);
  guard.step(2.9,{guardClose:false});assert.equal(guard.isShowing,false);
  guard.step(.1,{guardClose:true});assert.equal(guard.isShowing,true);
});
