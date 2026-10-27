import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { RunnerGame } from '../src/game-core.js';
import { PlayerMotion } from '../src/player-motion.js';
import { createChaserPresentation } from '../src/chaser-presentation.js';
const ticks=(g,n)=>{for(let i=0;i<n;i++)g.advance(1/120);};
const read=file=>JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${file}`,import.meta.url)));
function game(config={}){const g=new RunnerGame({acceleration:0,...config});g.entities=[];g.nextSection=1e9;g.start();return g;}

test('actual small front obstacle produces a hop and one stumble, followed by recovery',()=>{
 const g=game();g.addEntity({type:'barrier',lane:1,distance:1,height:.35});ticks(g,10);
 assert.equal(g.state.phase,'running');assert.ok(g.state.player.velocityY>0);assert.ok(g.state.stumble.isStumbling);
 assert.equal(g.events.filter(e=>e.type==='stumble').length,1);ticks(g,100);assert.equal(g.state.player.y,0);
});
test('ignored layers never consume the one-second prior solid collider death shortcut',()=>{
 for(const sourceLayer of ['Default','Unremovable']){
  const g=game();g.lastStumbleContact={entity:{id:777,type:'barrier'},at:0};
  g.addEntity({type:'barrier',lane:1,distance:1,sourceLayer});ticks(g,30);assert.equal(g.state.phase,'running');
 }
});
test('moving-train front corner retains post-critical stumble when the board protects the hit',()=>{
 const g=game();g.action('board');g.addEntity({type:'train',x:1.2,distance:1.1,width:2,depth:1,sourceTag:'HitMovingTrain'});g.action('right');
 ticks(g,6);assert.equal(g.state.phase,'running');assert.ok(g.events.some(e=>e.type==='board-hit'));assert.ok(g.events.some(e=>e.type==='stumble'));
});
test('paired catch waits three active seconds before offering the full eight seconds of revive',()=>{
 const g=game({catchPresentationSeconds:3});g.fatalHit({type:'barrier'});assert.equal(g.revive(),false);g.start();assert.equal(g.state.phase,'gameover');
 ticks(g,120);const left=g.state.catchRemaining;g.pause();ticks(g,240);assert.equal(g.state.catchRemaining,left);g.pause();
 ticks(g,240);assert.equal(g.state.catchRemaining,0);assert.equal(g.state.revival.phase,'offered');assert.equal(g.state.revival.offerRemaining,8);
 assert.equal(g.revive(),true);ticks(g,18);assert.equal(g.state.phase,'running');
});
test('moving-train death retains the source default presentation wait',()=>{
 const g=game({catchPresentationSeconds:3});g.fatalHit({type:'train'},'death_moving_train');assert.equal(g.state.catchRemaining,3);assert.notEqual(g.state.revival.phase,'offered');
});
test('normal motion selects source pools, respects landing during rolls and replays accepted roll tokens',()=>{
 const g=game(),p=g.state.player,m=new PlayerMotion(read('classic-motion-pools.json')),actor={clipDurations:{dodge_right:.5,landing:.166667,roll:.5416669845581055}};
 g.action('right');let choice=m.select(g.state,g.drainEvents(),actor);assert.equal(choice.name,'dodge_right');assert.equal(choice.speed,1);
 g.action('jump');choice=m.select(g.state,g.drainEvents(),actor);assert.ok(read('classic-motion-pools.json').jump.includes(choice.name));
 g.action('roll');choice=m.select(g.state,g.drainEvents(),actor);assert.equal(choice.name,'roll');const token=choice.token;
 choice=m.select(g.state,[{type:'land',velocityY:-12,rolling:true}],actor);assert.equal(choice.name,'roll');
 ticks(g,67);g.action('roll');choice=m.select(g.state,g.drainEvents(),actor);assert.notEqual(choice.token,token);
});
test('red-nose catch resolves source pair, advances hidden avatar time, freezes on pause and clears on revive',()=>{
 const manifest=read('manifest.json'),calls=[],actor={object:new THREE.Group(),mixer:{update(){}},setAnimation(...a){calls.push(a);},setTimeScale(){}};
 const view=createChaserPresentation({guard:actor},{bindings:read('classic-animation-bindings.json'),sourceActors:manifest.chaserActors,additions:manifest.guardAnimationAdditions});
 const g=game();g.stumble();view.update(g.state,.1);g.fatalHit({type:'barrier'});view.update(g.state,.3);
 assert.ok(view.catchAvatar.name.startsWith('caught_'));assert.equal(view.catchAvatar.weight,0);assert.ok(view.catchAvatar.time>.2);
 assert.ok(calls.at(-1)[0].startsWith('guard_caught_'));
 g.pause();const time=view.catchAvatar.time;view.update(g.state,2);assert.equal(view.catchAvatar.time,time);g.pause();view.update(g.state,1);assert.equal(view.catchAvatar.weight,1);
 g.revive();ticks(g,18);view.update(g.state,.1);assert.equal(view.catchAvatar,null);assert.equal(calls.at(-1)[0],'run');
});
