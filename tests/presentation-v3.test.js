import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { sampleSourceTrack, SourceCameraRig } from '../src/source-camera-rig.js';
const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/manifest.json',import.meta.url)));
const duration = manifest.introAnimationAdditions.clips.intro_run.duration;
const introOptions = { introDuration: duration, startFov: 45, runningFov: 71, aspect: 1 };
const advance = (g, seconds) => { for (let i=0;i<Math.round(seconds*120);i++) g.advance(1/120); };
test('actual source intro gates all actions, starts close-guard timer before running, pause freezes it',()=>{
 const g=new RunnerGame();g.introOptions=introOptions;g.start();
 assert.equal(g.state.phase,'intro');assert.equal(g.state.stumble.guardDistanceNative,10);
 for(const action of ['left','right','jump','roll','board']) assert.equal(g.action(action),false);
 advance(g,.5); const before={...g.state.intro};g.pause();advance(g,3);
 assert.equal(g.state.intro.elapsed,before.elapsed);assert.equal(g.state.distance,0);assert.equal(g.state.coins,0);
 g.pause();advance(g,.8);assert.equal(g.state.phase,'running');assert.ok(g.state.stumble.timeLeft<3.8);
 assert.equal(g.state.player.rollToken,0);assert.equal(g.state.player.lane,1);
 const cues=g.drainEvents().map(x=>x.type);assert.equal(cues.filter(x=>x==='start').length,1);
 assert.ok(cues.indexOf('player-intro')<cues.indexOf('start'));
});
test('repeat start cannot restart intro and a replay starts a fresh source sequence',()=>{
 const g=new RunnerGame();g.introOptions=introOptions;g.start();advance(g,.5);g.start();assert.ok(g.state.intro.elapsed>.49);
 advance(g,1);g.state.phase='gameover';g.start();assert.equal(g.state.phase,'intro');assert.equal(g.state.intro.elapsed,0);
});
test('camera source Hermite interpolation retains slopes, clamps and handles single keys',()=>{
 const track={times:[0,1],values:[[0,0,0],[1,2,3]],outTangents:[[0,0,0],[0,0,0]],inTangents:[[0,0,0],[0,0,0]]};
 assert.deepEqual(sampleSourceTrack(track,.5),[.5,1,1.5]);assert.deepEqual(sampleSourceTrack(track,2),[1,2,3]);
 assert.deepEqual(sampleSourceTrack({times:[0],values:[[3,4,5]]},1),[3,4,5]);
});
test('source camera uses hierarchy and Unity +Z forward before view reflection',()=>{
 const graph={nodes:[{id:'root',parentId:null,name:'rig',position:[10,0,0],quaternion:[0,0,0,1],scale:[1,1,1]},{id:'cam',parentId:'root',name:'Main Camera',position:[0,30,-30],quaternion:[0,0,0,1],scale:[1,1,1]}]};
 const pose=new SourceCameraRig(graph).sample(null,0,71);assert.equal(pose.position[0],1);assert.ok(Math.abs(pose.position[1]-3.38)<1e-6);assert.ok(Math.abs(pose.position[2]+3.3)<1e-6);assert.ok(pose.target[2]>pose.position[2]);assert.ok(pose.target[1]<pose.position[1]);
});
