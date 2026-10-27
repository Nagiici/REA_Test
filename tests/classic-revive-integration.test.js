import test from 'node:test';import assert from 'node:assert/strict';
import {RunnerGame} from '../src/game-core.js';
const frames=(g,t,hz=120)=>{for(let i=0;i<Math.round(t*hz);i++)g.advance(1/hz);};
function empty(){const g=new RunnerGame();g.entities=[];g.nextSection=1e9;g.start();return g;}
test('classic offer freezes course and score while source timers and speed ramp keep advancing',()=>{
  const g=empty();g.activatePowerup('magnet');frames(g,2);g.state.coins=7;g.fatalHit({type:'train',id:4});
  const before=structuredClone(g.state);frames(g,3);
  assert.equal(g.state.phase,'gameover');assert.equal(g.state.distance,before.distance);assert.equal(g.state.score,before.score);assert.equal(g.state.coins,7);
  assert.ok(Math.abs(g.state.powerups.magnet-(before.powerups.magnet-3))<1e-8);assert.ok(g.state.speed>before.speed);
  assert.ok(Math.abs(g.state.revival.offerRemaining-5)<1e-8);
});
test('one local revive preserves run progress, clears nearby source obstacles and launches the native recovery hop',()=>{
  const g=empty();g.action('left');frames(g,.4);g.activatePowerup('doubleScore');g.state.coins=9;
  g.addEntity({type:'train',lane:0,distance:g.state.distance+4});g.addEntity({type:'barrier',lane:0,distance:g.state.distance+60});
  g.fatalHit({type:'train'});const distance=g.state.distance,score=g.state.score,x=g.state.player.x,inventory=g.state.board.inventory;
  assert.equal(g.revive(),true);assert.equal(g.revive(),false);frames(g,.1);assert.equal(g.state.phase,'reviving');
  frames(g,5/120);assert.equal(g.state.phase,'reviving');frames(g,1/120);assert.equal(g.state.phase,'running');
  assert.equal(g.state.distance,distance);assert.equal(g.state.player.x,x);assert.equal(g.state.score,score);assert.equal(g.state.coins,9);assert.equal(g.state.board.inventory,inventory);
  assert.ok(Math.abs(g.state.player.velocityY-Math.sqrt(60))<1e-8);assert.equal(g.entities.filter(e=>e.type==='train').length,0);assert.equal(g.entities.filter(e=>e.type==='barrier').length,1);
  assert.ok(g.state.powerups.doubleScore>9);assert.equal(g.state.revival.credits,0);
  g.fatalHit({type:'barrier'});assert.equal(g.revive(),false);assert.notEqual(g.state.revival.phase,'offered');
  g.start();assert.equal(g.state.revival.credits,1);assert.equal(g.state.distance,0);assert.equal(g.state.coins,0);
});
test('pause freezes SaveMe countdown and revival delay; expired effects are not restored',()=>{
  const g=empty();g.activatePowerup('sneakers');frames(g,4);g.fatalHit({type:'train'});g.pause();
  const before=structuredClone(g.state);frames(g,5);assert.deepEqual(g.state,before);
  g.pause();frames(g,6.5);assert.equal(g.state.powerups.sneakers,undefined);assert.equal(g.revive(),true);
  g.pause();frames(g,1);assert.equal(g.state.pausedFrom,'reviving');g.pause();frames(g,.15);assert.equal(g.state.phase,'running');assert.equal(g.state.powerups.sneakers,undefined);
});
test('expired offers reject late input and browser gap restoration lands on the cleared floor',()=>{
  const g=empty();g.fatalHit({type:'train'});frames(g,8.1);assert.equal(g.revive(),false);assert.equal(g.state.revival.phase,'finished');
  g.reset();g.entities=[];g.nextSection=1e9;g.start();g.addEntity({type:'gap',lane:1,distance:15,width:2,depth:30});
  frames(g,1);assert.equal(g.state.phase,'gameover');assert.ok(g.state.player.y<0);assert.equal(g.revive(),true);frames(g,1.1);assert.equal(g.state.phase,'running');assert.equal(g.state.player.y,0);
});
