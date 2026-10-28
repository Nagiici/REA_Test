import test from 'node:test';
import assert from 'node:assert/strict';
import { Jetpack, HEADSTART } from '../src/jetpack.js';
import { ClassicCamera, classicCameraFov } from '../src/classic-camera.js';
import { RunnerGame } from '../src/game-core.js';

const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function empty(){const g=new RunnerGame({acceleration:0});g.entities=[];g.nextSection=1e9;g.start();return g;}

test('headstart static durations/speeds use their own takeoff-inclusive distance and no pickup multiplier',()=>{
  assert.deepEqual(HEADSTART.map(x=>[x.seconds,x.speed,x.height]),[[6,40,9.5],[8,55,10.5],[10,70,12]]);
  const j=new Jetpack({tier:6}),s=j.begin({distance:0,y:0,levelSpeed:18,headstart:true});
  assert.equal(s.speed,40);assert.equal(s.takeoffDistance,60);assert.equal(s.targetZ,234);assert.equal(s.headstartTier,0);
  near(j.step(.1,{distance:30}).y,4.75);
});

test('turbo applies on cruise, extends target without resetting takeoff origin, and raises height',()=>{
  const j=new Jetpack();j.begin({distance:0,y:0,levelSpeed:11,headstart:true});
  assert.equal(j.turbo(),true);assert.equal(j.step(.1,{distance:30}).speed,40);
  const cruise=j.step(.1,{distance:60});assert.equal(cruise.speed,55);assert.equal(cruise.startDistance,0);assert.equal(cruise.takeoffDistance,60);
  assert.equal(cruise.targetZ,432);assert.ok(cruise.y<=10.5);
  j.step(2,{distance:100});assert.equal(j.y,10.5);
  assert.equal(j.turbo(),true);const fast=j.step(.1,{distance:110});assert.equal(fast.speed,70);assert.equal(fast.targetZ,720);
  near(fast.y,11);assert.equal(j.turbo(),false);assert.equal(fast.headstartTier,2);
});

test('turbo visibility and acceptance use distinct strict .8/.9 cruise boundaries',()=>{
  const j=new Jetpack();const s=j.begin({distance:0,y:0,levelSpeed:11,headstart:true});
  const position=q=>s.takeoffDistance+q*(s.targetZ-s.takeoffDistance);
  let at=j.step(.01,{distance:position(Math.fround(.8))});assert.equal(at.turboVisible,true);
  at=j.step(.01,{distance:position(Math.fround(.8)+1e-5)});assert.equal(at.turboVisible,false);assert.equal(at.turboAvailable,true);
  at=j.step(.01,{distance:position(Math.fround(.9))});assert.equal(at.turboAvailable,true);
  at=j.step(.01,{distance:position(Math.fround(.9)+1e-5)});assert.equal(at.turboAvailable,false);assert.equal(j.turbo(),false);
});

test('headstart FOV clamps aspect, pauses, pulses once, and restores actual FOV',()=>{
  for(const aspect of [.4,9/16,16/9,2.4]){
    const c=new ClassicCamera({aspect});const initial=c.fov;c.beginHeadstartFov();
    c.step(.5,{position:[0,0,0],enabled:false});near(c.fov,initial);
    c.stepFov(1);near(c.fov,(classicCameraFov(aspect).runningField+10)/Math.max(Math.fround(.56),Math.min(Math.fround(1.78),aspect)));
    const base=c.fov;assert.equal(c.pulseHeadstartFov(),true);assert.equal(c.pulseHeadstartFov(),false);
    c.stepFov(Math.fround(.8)/2);near(c.fov,base*Math.fround(1.2));
    c.stepFov(Math.fround(.8)/2);near(c.fov,base);
    c.endHeadstartFov();c.stepFov(1);near(c.fov,initial);
  }
  const c=new ClassicCamera();c.fov=100;c.endHeadstartFov();c.stepFov(.01,{runningOrJetpack:false});near(c.fov,classicCameraFov(9/16).running);
});

test('ordinary jetpack never requests headstart FOV or turbo input',()=>{
  const g=empty();g.activatePowerup('jetpack');assert.equal(g.action('turbo'),false);
  assert.equal(g.events.some(e=>e.type.includes('headstart')),false);
  const c=new ClassicCamera(),f=c.fov;c.step(.2,{position:[0,2,10],jetpack:g.state.flight});near(c.fov,f);
});

test('same-frame shoe removal and re-add retriggers the source pose transition',()=>{
  const c=new ClassicCamera();c.step(.5,{position:[0,4,10],grounded:false,sneakers:true});
  c.step(1,{position:[0,4,11],grounded:false,sneakers:true});
  c.sneakersChanged(false);c.sneakersChanged(true);assert.equal(c.transitionTime,0);
  c.step(.1,{position:[0,4,12],grounded:false,sneakers:true});near(c.transitionTime,.1);
});

test('game opens headstart without airborne coin line, preserves pause, advances ramp age on exit',()=>{
  const g=empty();assert.equal(g.activateHeadstart(),true);assert.equal(g.entities.some(e=>e.type==='coin'),false);
  assert.equal(g.events.filter(e=>e.type==='turbo-headstart').length,1);
  const before=g.state.flight;g.pause();g.advance(.1);assert.equal(g.state.flight,before);g.pause();
  g.state.player.y=9.5;g.state.distance=g.state.flight.targetZ;g.advance(1/120);
  assert.equal(g.state.flight,null);near(g.state.levelSpeed,11+11*Math.fround(.01));
  assert.ok(g.events.some(e=>e.type==='headstart-end'));
  assert.equal(g.state.player.transitionFromHeight,true);
});
