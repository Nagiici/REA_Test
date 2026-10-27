import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ClassicCamera, tunnelCameraDelta, tunnelCameraKeys } from '../src/classic-camera.js';
import { ClassicTunnelModifiers, ClassicCameraVolumes } from '../src/classic-camera-volumes.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const state=distance=>({phase:'running',distance,player:{x:0,y:0,grounded:true,rollRemaining:0}});
const trigger=(id,start,end,length=25.2)=>({id,type:'decoration',x:0,distance:(start+end)/2,
  bottom:-1,height:5,width:3,depth:end-start,tunnelModifier:{length}});

test('tunnel curve matches unchanged APK engine insertion results, including rewritten first slope',()=>{
  const keys=tunnelCameraKeys(25.2);
  near(keys[0][2],-.0793650820851326,1e-10);assert.equal(keys[0][2],keys[1][2]);
  const expected=[0,-.5,-1,-.626575,0];
  for(let i=0;i<expected.length;i++)near(tunnelCameraDelta(i*6.3,25.2),expected[i]);
  assert.ok(tunnelCameraDelta(14,25.2)<-1,'source middle tangent is negative, not a flat smoothstep');
  near(tunnelCameraKeys(18)[0][2],-.1111111119389534,1e-10);
  near(tunnelCameraKeys(9)[0][2],-.2222222238779068,1e-10);
  assert.throws(()=>tunnelCameraKeys(0),RangeError);
});

test('entry samples current player distance once and the modifier outlives its short trigger',()=>{
  const camera=new ClassicCamera(),track=new ClassicTunnelModifiers(),s=state(8),e=trigger(1,10,12);
  track.update(s,[e],camera);assert.equal(camera.modifier,null);
  s.distance=9.7;track.update(s,[e],camera);near(camera.modifier.startZ,9.7);
  s.distance=11;track.update(s,[e],camera);near(camera.modifier.startZ,9.7);
  s.distance=22.3;track.update(s,[e],camera);
  const mid=camera.step(1/60,{position:[0,0,s.distance]});near(mid.position[1],1.8);
  s.distance=34.9;track.update(s,[e],camera);
  near(camera.step(1/60,{position:[0,0,s.distance]}).position[1],3.3);
  s.distance=11;track.update(s,[e],camera);near(camera.modifier.startZ,11);
});

test('another entry replaces the curve; pause/reset and disabled flight contacts are respected',()=>{
  const camera=new ClassicCamera(),track=new ClassicTunnelModifiers(),s=state(11);
  const a=trigger(1,10,12),b=trigger(2,14,16,18);
  track.update(s,[a,b],camera);s.phase='paused';s.distance=15;
  track.update(s,[a,b],camera);near(camera.modifier.startZ,11);
  s.phase='running';s.flight={characterColliderEnabled:false};track.update(s,[a,b],camera);near(camera.modifier.startZ,11);
  s.flight=null;track.update(s,[a,b],camera);near(camera.modifier.startZ,15);near(camera.modifier.length,18);
  const fresh=state(0);track.update(fresh,[a,b],camera);assert.equal(camera.modifier,null);
});

test('Tunnel distance curve and Subway ceiling restriction are independent; jetpack bypasses follow modifier',()=>{
  const camera=new ClassicCamera(),tunnels=new ClassicTunnelModifiers(),volumes=new ClassicCameraVolumes();
  const s=state(0),t=trigger(1,-1,1),subway={...trigger(2,-5,50),tunnelModifier:undefined,cameraVolume:{kind:'Subway',maxY:1.6}};
  tunnels.update(s,[t,subway],camera);s.distance=12.6;tunnels.update(s,[t,subway],camera);
  near(camera.step(1/60,{position:[0,0,12.6],...volumes.update(s,[t,subway])}).position[1],1.6);
  const jetpack={active:true,takingOff:false,startDistance:0,takeoffDistance:33};
  near(camera.step(1/60,{position:[0,9.5,12.6],jetpack}).position[1],12.8);
});

test('real selected route graphs emit original Tunnel boxes and authored length with world placement',()=>{
  const library=JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json',import.meta.url)));
  const generator=new SourceRouteGenerator(library,{seed:40});const found=new Set();
  for(const seed of [40,41,42,43,44,45]) {
  generator.reset(seed);
  for(const id of Object.keys(library.routes)) {
    const chunk=generator.compileChunk(id,{startDistance:200,speed:11});
    for(const e of chunk.entities.filter(e=>e.tunnelModifier)) {
      assert.equal(e.type,'decoration');assert.equal(e.visual,null);assert.equal(e.sourceShape.type,'box');
      near(e.tunnelModifier.length,25.2);near(e.depth,9);assert.ok(e.distance>150);
      found.add(e.provenance.tunnel.asset);
    }
  }
  }
  assert.equal(found.size,4);
});
