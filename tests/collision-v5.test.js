import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
const ticks = (g,n) => { for(let i=0;i<n;i++)g.advance(1/120); };
function game(config={}) {
  const g=new RunnerGame({acceleration:0,catchPresentationSeconds:3,...config});
  g.entities=[];g.nextSection=1e9;g.start();return g;
}

test('airborne death cancels ascent and holds popup time until vertical-only grounding completes', () => {
  const g=game();g.action('jump');ticks(g,12);const p=g.state.player;
  const x=p.x,z=g.state.distance,y=p.y;
  g.fatalHit({type:'train'});assert.ok(g.state.deathGrounding);
  ticks(g,1);assert.ok(p.y<=y);assert.equal(p.velocityY,0);
  assert.equal(p.x,x);assert.equal(g.state.distance,z);assert.equal(g.state.catchRemaining,3);
  for(let i=0;i<300&&g.state.deathGrounding;i++)ticks(g,1);
  assert.equal(g.state.deathGroundingResult,'grounded');assert.equal(p.y,0);
  assert.equal(g.state.catchRemaining,3);assert.equal(g.revive(),false);
  ticks(g,360);assert.equal(g.state.revival.phase,'offered');assert.equal(g.state.revival.offerRemaining,8);
});

test('grounding has an unscaled five-second bound; pause freezes gravity and popup state', () => {
  const g=game();g.addEntity({type:'gap',x:0,distance:0,depth:50,width:4});
  Object.assign(g.state.player,{y:5,grounded:false,velocityY:4});
  g.fatalHit({type:'gap'});g.pause();const y=g.state.player.y;
  g.advance(.1,{realtimeDelta:6});assert.equal(g.state.player.y,y);assert.ok(g.state.deathGrounding);
  assert.equal(g.state.catchRemaining,3);assert.equal(g.revive(),false);
  g.pause();ticks(g,1);assert.equal(g.state.deathGroundingResult,'timeout');assert.equal(g.state.catchRemaining,3);
  ticks(g,1);assert.ok(g.state.catchRemaining<3);
});

test('zero-wait configuration cannot bypass airborne grounding by restart or revival', () => {
  const g=game({catchPresentationSeconds:0});Object.assign(g.state.player,{y:1,grounded:false});
  g.fatalHit({type:'barrier'});g.start();assert.equal(g.state.phase,'gameover');assert.equal(g.revive(),false);
  ticks(g,80);assert.equal(g.state.deathGrounding,null);assert.equal(g.state.revival.phase,'offered');
});

test('nearby train children continue after death; proxy is disabled, distant trains and scenery stay still', () => {
  const g=game();
  const proxy=g.addEntity({type:'train',distance:10,depth:4,movingTrainProxy:{motionId:'near',ratio:.5}});
  const farProxy=g.addEntity({type:'train',distance:22,depth:4,movingTrainProxy:{motionId:'far',ratio:.5}});
  const child=(motionId,distance)=>g.addEntity({type:'decoration',distance,motionId,
    movingTrain:{initialDistance:distance,referencePlayerDistance:0,ratio:.5}});
  const train=child('near',10),far=child('far',22),scenery=g.addEntity({type:'decoration',distance:10});
  g.fatalHit({type:'barrier'});assert.equal(proxy.collisionDisabled,true);assert.equal(farProxy.collisionDisabled,undefined);
  ticks(g,60);near(train.distance,7.25);assert.equal(g.state.distance,0);assert.equal(far.distance,22);assert.equal(scenery.distance,10);
  g.pause();ticks(g,120);near(train.distance,7.25);g.pause();
  g.state.speed=22;g.stepTrainAutopilot(.1);near(train.distance,6.15);
  const before=train.distance;g.state.phase='running';ticks(g,1);
  near(train.distance,before-11*.5/120);assert.equal(proxy.collisionDisabled,true);
});

test('board absorption preserves pre-death impact shake and train jump notification order', () => {
  const g=game();g.action('board');g.drainEvents();
  g.addEntity({type:'train',lane:1,distance:1.1,width:2,depth:1,sourceTag:'HitMovingTrain'});
  ticks(g,12);const types=g.drainEvents().map(e=>e.type);
  assert.equal(g.state.phase,'running');assert.equal(g.state.board.active,false);
  assert.ok(types.indexOf('train-jump')>=0);assert.ok(types.indexOf('critical-hit')>types.indexOf('train-jump'));
  assert.ok(types.indexOf('board-hit')>types.indexOf('critical-hit'));assert.ok(!types.includes('crash'));
  assert.equal(g.state.player.canAccelerateForward,false);assert.equal(g.state.speed,11);
  ticks(g,24);assert.equal(g.state.player.canAccelerateForward,true);
});

test('real route train proxies retain the same motion group as their moving visual children', () => {
  const library=JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json',import.meta.url)));
  library.modelBindings=JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${library.modelBindingsFile}`,import.meta.url)));
  const generator=new SourceRouteGenerator(library,{seed:40});let found=0;
  for(const route of Object.keys(library.routes)) {
    const chunk=generator.compileChunk(route,{startDistance:0,speed:11});
    for(const proxy of chunk.entities.filter(e=>e.movingTrainProxy)) {
      const children=chunk.entities.filter(e=>e.motionId===proxy.movingTrainProxy.motionId&&e.movingTrain);
      assert.ok(children.length>0);assert.ok(children.every(e=>e.movingTrain.ratio===proxy.movingTrainProxy.ratio));found++;
    }
    if(found>=4)break;
  }
  assert.ok(found>=4);
});
