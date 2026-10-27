import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Matrix4 } from 'three';
import { ClassicCameraVolumes, overlapsSubwayVolume } from '../src/classic-camera-volumes.js';
import { SourceRouteGenerator, colliderBounds, colliderShape } from '../src/route-generator.js';

const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
const state = (distance=0) => ({ phase:'running',distance,player:{x:0,y:0,rollRemaining:0},flight:null });
const volume = (id, start, end, top=6) => ({ id,type:'decoration',x:0,distance:(start+end)/2,
  width:4,depth:end-start,bottom:-1,height:top,cameraVolume:{kind:'Subway',maxY:top-.3} });

test('source Subway trigger is emitted with runtime placement, precise tag and no hazard type', () => {
  const read = name => JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${name}`,import.meta.url)));
  const library = read('route-library.json');
  library.collisionTags = read('classic-collision-index.json');
  const generator = new SourceRouteGenerator(library,{seed:40});
  const id = Object.keys(library.routes).find(key=>key.endsWith('routechunk_short_2_tracks_mid_var_2'));
  const chunk = generator.compileChunk(id,{startDistance:200,speed:11});
  const triggers = chunk.entities.filter(e=>e.cameraVolume);
  assert.equal(triggers.length,1);
  const e = triggers[0];
  assert.equal(e.type,'decoration');assert.equal(e.visual,null);assert.equal(e.sourceTag,'Subway');
  assert.equal(e.provenance.collider.pathId,'116');assert.equal(e.sourceShape.type,'box');
  near(e.distance,254);near(e.width,13);near(e.depth,72);near(e.bottom,-.55);near(e.height,5.95);near(e.cameraVolume.maxY,5.65);
  const tracker = new ClassicCameraVolumes(), s = state(230);
  assert.deepEqual(tracker.update(s,[e]),{insideSubway:true,subwayMaxY:5.65});
});

test('last Enter sets height; Exit does not recompute height from remaining volumes', () => {
  const tracker = new ClassicCameraVolumes(), s = state(2);
  const a=volume(1,0,10,8), b=volume(2,5,15,6);
  assert.deepEqual(tracker.update(s,[a,b]),{insideSubway:true,subwayMaxY:7.7});
  s.distance=6;assert.deepEqual(tracker.update(s,[a,b]),{insideSubway:true,subwayMaxY:5.7});
  s.distance=2;assert.deepEqual(tracker.update(s,[a,b]),{insideSubway:true,subwayMaxY:5.7});
  s.distance=30;assert.deepEqual(tracker.update(s,[a,b]),{insideSubway:false,subwayMaxY:5.7});
});

test('source capsule geometry rejects AABB-only corner overlaps and respects roll height', () => {
  const e=volume(1,-1,1,2);e.width=2;
  const s=state(1.15);s.player.x=1.25;
  assert.equal(overlapsSubwayVolume(s,e),false);
  s.player.x=0;s.distance=0;e.bottom=.9;e.height=2;
  assert.equal(overlapsSubwayVolume(s,e),true);
  s.player.rollRemaining=.2;assert.equal(overlapsSubwayVolume(s,e),false);
});

test('source rotated box uses orthogonal inverse slabs rather than its broad AABB', () => {
  const fields={m_Size:{x:20,y:20,z:20},m_Center:{x:0,y:0,z:0}};
  const matrix=new Matrix4().makeRotationY(Math.PI/4), bounds=colliderBounds(fields,matrix);
  const e={...bounds,sourceShape:colliderShape(fields,matrix,bounds),cameraVolume:{kind:'Subway',maxY:bounds.height-.3}};
  const s=state(1.2);s.player.x=1.3;
  assert.equal(overlapsSubwayVolume(s,e),false);
  s.player.x=0;s.distance=0;assert.equal(overlapsSubwayVolume(s,e),true);
});

test('jetpack ForceLeave uses strict height threshold and does not reenter the same outstanding contact', () => {
  const tracker=new ClassicCameraVolumes(),s=state(4),e=volume(1,0,10,6);
  tracker.update(s,[e]);
  s.flight={takingOff:true,characterColliderEnabled:false};s.player.y=5.7;
  assert.equal(tracker.update(s,[e]).insideSubway,true);
  s.player.y=5.70001;assert.equal(tracker.update(s,[e]).insideSubway,false);
  s.flight=null;s.player.y=0;assert.equal(tracker.update(s,[e]).insideSubway,false);
  s.distance=20;tracker.update(s,[e]);s.distance=4;
  assert.equal(tracker.update(s,[e]).insideSubway,true);
});

test('pause freezes trigger state; reset/restart clears it even with reused entity IDs', () => {
  const tracker=new ClassicCameraVolumes(),s=state(4),e=volume(1,0,10,6);
  tracker.update(s,[e]);s.phase='paused';s.distance=30;
  assert.equal(tracker.update(s,[e]).insideSubway,true);
  s.phase='running';assert.equal(tracker.update(s,[e]).insideSubway,false);
  const newState=state(4);assert.equal(tracker.update(newState,[e]).insideSubway,true);
  newState.phase='ready';assert.equal(tracker.update(newState,[e]).insideSubway,false);
});
