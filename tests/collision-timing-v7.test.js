import test from 'node:test';
import assert from 'node:assert/strict';
import { RunnerGame } from '../src/game-core.js';
const dt=1/120, tick=g=>g.advance(dt);
function empty(config={}){const g=new RunnerGame({acceleration:0,...config});g.entities=[];g.nextSection=1e9;g.start();g.drainEvents();return g;}

test('physical contact precedes one landing notification and retains incoming impact velocity',()=>{
  const g=empty(),p=g.state.player;
  Object.assign(p,{y:.01,velocityY:-8,grounded:false,isJumping:true,isFalling:true,transitionFromHeight:true});
  tick(g);assert.equal(p.y,0);assert.equal(p.grounded,true);assert.equal(p.isJumping,true);
  assert.equal(p.lastGroundedY,.01);assert.equal(p.transitionFromHeight,true);
  assert.equal(g.events.some(e=>e.type==='land'),false);const impact=p.velocityY;
  g.pause();g.advance(.1);assert.equal(g.events.length,0);g.pause();
  tick(g);const land=g.events.find(e=>e.type==='land');assert.equal(land.velocityY,impact);
  assert.equal(p.isJumping,false);assert.equal(p.transitionFromHeight,false);assert.equal(p.velocityY,-20*dt);
  for(let i=0;i<30;i++)tick(g);assert.equal(g.events.filter(e=>e.type==='land').length,1);
});

test('Hangtime is prepared before contact; quiet grounded steps do not invent landing events',()=>{
  const g=empty(),p=g.state.player;Object.assign(p,{y:.005,velocityY:-2,grounded:false,isFalling:false});
  tick(g);assert.deepEqual(g.drainEvents().map(e=>e.type),['hangtime']);assert.equal(p.grounded,true);
  tick(g);assert.deepEqual(g.drainEvents().map(e=>e.type),['land']);
  const flat=empty();for(let i=0;i<30;i++)tick(flat);assert.equal(flat.events.length,0);
});

test('buffered jump launches on physical contact without an intervening landing pose',()=>{
  const g=empty(),p=g.state.player;Object.assign(p,{y:.01,velocityY:-8,grounded:false,isJumping:true,isFalling:true,transitionFromHeight:true});
  assert.equal(g.action('jump'),false);tick(g);
  assert.equal(p.inAirJump,false);assert.equal(p.grounded,false);assert.equal(p.transitionFromHeight,false);assert.ok(p.velocityY>0);
  assert.deepEqual(g.events.map(e=>e.type),['jump']);tick(g);assert.ok(p.y>0);assert.equal(g.events.some(e=>e.type==='land'),false);
});

test('stationary and sub-epsilon samples retain the last meaningful collision-plane motion',()=>{
  const g=empty({initialSpeed:0}),p=g.state.player;
  g.state.distance=1;tick(g);assert.deepEqual(g.lastFixedPosition,[0,0,1]);
  const previous=g.previousFixedPosition,last=g.lastFixedPosition;
  for(let i=0;i<10;i++)tick(g);assert.equal(g.previousFixedPosition,previous);assert.equal(g.lastFixedPosition,last);
  g.state.distance=1+1e-7;tick(g);assert.equal(g.lastFixedPosition,last);
  g.state.distance=1+2e-6;tick(g);assert.equal(g.previousFixedPosition,last);assert.notEqual(g.lastFixedPosition,last);assert.equal(p.y,0);
});

test('protected simultaneous front contacts dispatch individually and persist without repeated Enter',()=>{
  const g=empty();g.action('board');
  const a=g.addEntity({type:'train',x:0,distance:3.4,width:1.8,depth:6,height:3});
  const b=g.addEntity({type:'train',x:0,distance:3.4,width:1.8,depth:6,height:3});
  tick(g);assert.equal(g.state.phase,'running');assert.deepEqual([...g.contacts],[a.id,b.id]);
  assert.equal(g.events.filter(e=>e.type==='board-hit').length,1);
  assert.equal(g.events.filter(e=>e.type==='critical-hit').length,2);
  const count=g.events.filter(e=>e.type==='stumble').length;
  for(let i=0;i<6;i++)tick(g);assert.equal(g.events.filter(e=>e.type==='stumble').length,count);
});

test('a fatal contact stops later pickup callbacks in the same step',()=>{
  const g=empty();g.addEntity({type:'train',x:0,distance:3.4,width:1.8,depth:6,height:3});
  const pickup=g.addEntity({type:'powerup',powerup:'magnet',x:0,distance:.1,y:.85});
  tick(g);assert.equal(g.state.phase,'gameover');assert.equal(pickup.collected,false);
  assert.equal(g.events.filter(e=>e.type==='crash').length,1);
});

test('a side rebound does not postpone another simultaneous trigger Enter until the next step',()=>{
  const g=empty();g.action('right');
  const shape={x:2,distance:10,width:1.7,depth:30,height:3};
  const a=g.addEntity({type:'train',...shape});
  const b=g.addEntity({type:'obstacle',...shape,sourceIsTrigger:true,sourceLayer:'Hit',sourceTag:'Stumble'});
  for(let i=0;i<30&&!g.contacts.size;i++)tick(g);
  assert.equal(g.state.player.lane,1);assert.deepEqual([...g.contacts],[a.id,b.id]);
  assert.equal(g.events.filter(e=>e.type==='stumble').length,2);
  tick(g);assert.equal(g.events.filter(e=>e.type==='stumble').length,2);
});
