import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { EnvironmentRouteGenerator } from '../src/environment-layout.js';
const root=new URL('../public/assets/recovered/',import.meta.url);
const read=n=>JSON.parse(fs.readFileSync(new URL(n,root)));
const library=read('route-library.json');library.modelBindings=read(library.modelBindingsFile);
const bindings=read(read('manifest.json').environmentBindings);
const make=(seed,now=()=>0)=>{const g=new RunnerGame({seed,acceleration:0});
 g.setRouteGenerator(new EnvironmentRouteGenerator(new SourceRouteGenerator(library,{seed}),bindings,{workerOptions:{now}}));
 g.headstartOnStart=true;g.start();return g;};

function fly(g,tier,fps){
 const targets=[g.state.flight.targetZ];let boost=0;
 for(let i=0;i<fps*30&&g.state.flight&&g.state.phase==='running';i++){
  if(boost<tier&&g.state.elapsed>=2+boost*2){assert.equal(g.action('turbo'),true);boost++;}
  g.advance(1/fps);
  const target=g.state.flight?.targetZ;if(target&&target!==targets.at(-1))targets.push(target);
 }
 assert.equal(g.state.phase,'running');assert.equal(g.state.flight,null);assert.equal(boost,tier);
 return targets;
}
function assertSeams(g,targets){
 const landings=g.routeTrace.filter(c=>c.jetpackLanding?.kind==='landing');
 assert.deepEqual(landings.map(c=>c.startDistance),targets,'earlier tier directives remain queued in source order');
 for(const l of landings){assert.equal(l.length,18);assert.equal(l.jetpackLanding.adapter,'source-build-directive');}
 assert.ok(g.routeTrace.some(c=>c.startDistance===targets.at(-1)+18&&!c.jetpackLanding));
 assert.ok(!g.routeTrace.some(c=>c.jetpackLanding?.kind==='landing-safety-padding'));
 assert.ok(!g.routeGenerator.queue.events.some(e=>['reject-landing','missed-strict-landing'].includes(e.type)));
}

test('36 headstart/turbo runs at 30/60/120Hz retain exact tier directives and land through ordinary physics without extra runway',()=>{
 for(const fps of [30,60,120])for(const tier of [0,1,2])for(let seed=1;seed<=4;seed++){
  const g=make(seed),targets=fly(g,tier,fps);
  assert.equal(g.state.player.lane,1,'flight ending does not force a lane');
  assert.ok(g.state.player.velocityY<=0&&g.state.player.velocityY>=-g.config.gravity/fps-1e-6, 'exit clears vertical speed then ordinary gravity advances within the frame');assert.equal(g.state.player.grounded,false);
  assert.equal(g.state.levelSpeed,Math.min(22,11+11*[Math.fround(.01),.5,1][tier]));
  // Authored obstacles may be ahead of the center lane; ordinary steering
  // during descent is available without changing colliders or granting immunity.
  assert.equal(g.action('right'),true);
  for(let i=0;i<fps*3&&!g.state.player.grounded&&g.state.phase==='running';i++)g.advance(1/fps);
  assert.equal(g.state.phase,'running',`fps=${fps} tier=${tier} seed=${seed} ${JSON.stringify(g.state.collision)}`);
  assert.equal(g.state.player.grounded,true);assert.equal(g.state.player.y,g.state.player.floor);
  assertSeams(g,targets);
  assert.equal(g.action('jump'),true,'real support permits the following jump');
 }
});

test('turbo replaces the reward row while preserving old route requests, and a restart clears pending work',()=>{
 const g=make(40),first=g.state.flight.targetZ;
 for(let i=0;i<240;i++)g.advance(1/120);
 assert.equal(g.action('turbo'),true);g.advance(1/120);const second=g.state.flight.targetZ;
 assert.ok(second>first);
 assert.ok(g.entities.filter(e=>e.headstartReward).every(e=>e.distance===second));
 assert.ok(g.routeGenerator.queue.directives.some(d=>d.target===second));
 assert.ok(g.routeGenerator.queue.chunks.some(c=>c.startDistance===first&&c.plan?.provenance.jetpackLanding));
 const oldQueue=g.routeGenerator.queue;g.reset();
 assert.notEqual(g.routeGenerator.queue,oldQueue);assert.equal(g.routeGenerator.queue.directives.length,0);
 assert.ok(!g.routeTrace.some(c=>c.jetpackLanding));
});


test('budget-exhausted worker still keeps high-speed headstart collision content ahead at 20/30/60/120Hz',()=>{
 for(const fps of [20,30,60,120]){
  let time=0;const g=make(1,()=>time+=10);let boosts=0,partialFrames=0;
  for(let i=0;i<fps*30&&g.state.flight;i++){
   if(boosts<2&&g.state.elapsed>=2+boosts*2){g.action('turbo');boosts++;}
   g.advance(1/fps);
   const q=g.routeGenerator.queue;
   assert.ok(q.readyEdge>g.state.distance+18,`content fell behind at ${fps}Hz`);
   if(q.worker.lastUpdate&&!q.worker.lastUpdate.completed)partialFrames++;
   assert.ok(q.worker.spawn.length<10&&q.worker.despawn.length<10);
  }
  assert.equal(boosts,2);assert.equal(g.state.flight,null);assert.ok(partialFrames>0);
  assert.ok(g.routeTrace.every((c,i,a)=>i===0||Math.abs(c.startDistance-a[i-1].startDistance-a[i-1].length)<1e-7));
 }
});
