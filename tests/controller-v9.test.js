import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Quaternion,Vector3} from 'three';
import {RunnerGame} from '../src/game-core.js';
import {controllerCapsule,controllerInterval,expandController,moveControllerVertical} from '../src/classic-controller.js';
import {capsuleEntitySeparation,runnerCapsule} from '../src/classic-contact.js';
import {colliderBounds,colliderShape} from '../src/route-generator.js';
const dt=1/120,near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const box=(extra={})=>({id:1,type:'obstacle',x:0,distance:0,width:2,depth:4,bottom:0,height:1,sourceIsTrigger:false,...extra});
function empty(){const g=new RunnerGame({acceleration:0});g.entities=[];g.nextSection=1e9;g.start();g.drainEvents();return g;}

test('physical standing and rolled capsules keep radius .2 independent of the .3 trigger',()=>{
 const a=controllerCapsule([0,0,0]),b=controllerCapsule([0,0,0],true);
 assert.deepEqual(a.a,[0,.2,0]);near(a.b[1],.7);assert.deepEqual(b.a,b.b);assert.equal(a.radius,.2);
 assert.equal(runnerCapsule([0,0,0],false).radius,.3);
});
test('rounded support has analytic side/corner heights, not a radius-expanded rectangle',()=>{
 const e=box();for(const [dx,dz] of [[.1,0],[.12,.09],[0,.17]]){
  const x=1+dx,z=dz?2+dz:0,q=controllerInterval(e,x,z);
  const d=Math.hypot(dx,dz);near(q.max,1-.2+Math.sqrt(.04-d*d));near(q.normal[1],Math.sqrt(.04-d*d)/.2);
  assert.equal(q.walkable,true);
 }
 assert.equal(controllerInterval(e,1.201,0),null);
 assert.equal(controllerInterval(e,1.15,2.15),null,'corner is outside circular footprint despite AABB overlap');
 assert.equal(controllerInterval(e,1.19,0).walkable,false,'70-degree slope limit rejects near-tangent shelf');
});
test('trigger overlap outside physical radius cannot supply support',()=>{
 const e=box(),point=[1.25,.75,0];assert.ok(capsuleEntitySeparation(runnerCapsule(point,false),e)<0);
 assert.equal(controllerInterval(e,point[0],point[2]),null);
});
test('rotated authored box and capsule support use their shapes, including rounded corners',()=>{
 const f={m_Size:{x:20,y:10,z:40},m_Center:{x:0,y:0,z:0}},m=new Matrix4().compose(new Vector3(0,5,0),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/4),new Vector3(1,1,1));
 const b=colliderBounds(f,m),e=box({...b,sourceShape:colliderShape(f,m,b)}),x=1.1/Math.sqrt(2),z=-x;
 near(controllerInterval(e,x,z).max,.8+Math.sqrt(.03));
 const cap=box({width:2,depth:2,bottom:0,height:4,sourceShape:{type:'capsule',rows:[[1,0,0,0],[0,1,0,-2],[0,0,1,0]],radius:1,halfSegment:1,axis:1}});
 near(controllerInterval(cap,.5,0).max,3+Math.sqrt(1.2**2-.5**2)-.2);
});
test('disabled and trigger-only objects cannot block an expansion probe',()=>{
 for(const extra of [{collisionDisabled:true},{sourceIsTrigger:true}]){
  const e=box({bottom:.45,height:2,...extra});assert.equal(controllerInterval(e,0,0),null);
  const r=expandController([0,0,0],true,[e]);near(r.trace[0].to[1],.2);near(r.position[1],0);
 }
});
test('roll end moves up squeezed then down standing; free-air and floor preserve position and flags',()=>{
 for(const y of [0,3]){
  const r=expandController([0,y,0],true,[]);assert.deepEqual(r.trace.map(t=>t.rolling),[true,false]);
  near(r.trace[0].to[1],y+.2);near(r.position[1],y);assert.equal(r.below,y===0);assert.equal(r.squeezed,false);
 }
});
test('up probe clips under a low ceiling; restored capsule escapes downward without teleporting through it',()=>{
 const e=box({bottom:.5,height:2}),r=expandController([0,0,0],true,[e]);
 near(r.trace[0].to[1],.1);near(r.position[1],0);assert.equal(r.squeezed,false);
 assert.deepEqual(r.overlaps,[1],'impossible .5-high gap cannot fit a .9 capsule and must remain explicit');
 const enough=expandController([0,0,0],true,[box({bottom:1,height:2})]);near(enough.position[1],0);assert.deepEqual(enough.overlaps,[]);
});
test('expansion over a lip finds the rounded support instead of returning blindly to old Y',()=>{
 const e=box(),r=expandController([1.1,.9,0],true,[e],{ground:-Infinity});
 near(r.position[1],.8+Math.sqrt(.03));assert.equal(r.below,true);assert.ok(r.position[1]>.9);
});
test('vertical sweep stops on the first thin face in either direction independent of entity order',()=>{
 const a=box({id:1,bottom:1,height:1.02}),b=box({id:2,bottom:2,height:2.02});
 for(const es of [[a,b],[b,a]]){
  near(moveControllerVertical([0,3,0],-4,false,es).position[1],2.02);
  near(moveControllerVertical([0,0,0],4,false,es).position[1],.1);
 }
});
test('each enabled gate is evaluated around owner removal and other squeeze owners survive',()=>{
 let enabled=true;const r=expandController([0,1,0],true,[],{enabled:()=>enabled,removeSqueeze:()=>{enabled=false;return true;}});
 near(r.position[1],1.2);assert.deepEqual(r.trace.map(t=>t.enabled),[true,false]);assert.equal(r.squeezed,true);
 const disabled=expandController([0,1,0],true,[],{enabled:false});near(disabled.position[1],1);assert.equal(disabled.squeezed,false);
 const other=expandController([0,0,0],true,[box({bottom:.5,height:2})],{removeSqueeze:()=>true});assert.deepEqual(other.trace.map(t=>t.rolling),[true,true]);assert.deepEqual(other.overlaps,[]);
});
test('ordinary jump does not probe, active roll Jump probes twice and old feedback cannot re-end it',()=>{
 const g=empty();g.action('jump');assert.equal(g.controllerExpansionCount,0);
 const h=empty();h.action('roll');const token=h.state.player.rollToken;h.action('jump');assert.equal(h.controllerExpansionCount,2);
 assert.equal(h.state.player.colliderSqueezed,false);assert.equal(h.state.player.rollRemaining,0);assert.ok(h.state.player.velocityY>0);
 h.updateAnimationState({roll:{token,enabled:false,rawLength:.54}});h.advance(dt);assert.equal(h.controllerExpansionCount,2);
 assert.deepEqual(h.events.map(e=>e.type),['roll','roll-end','jump']);
});
test('natural roll restoration preserves velocity, motion ground and collision-direction history',()=>{
 const g=empty();g.action('roll');g.drainEvents();const p=g.state.player;
 p.velocityY=-7;p.motionGrounded=false;g.ceiling={hit:true,minY:1,evaded:false};
 const before=g.previousFixedPosition,last=g.lastFixedPosition;g.endRoll('clip-length');
 assert.equal(p.velocityY,-7);assert.equal(p.motionGrounded,false);assert.equal(g.ceiling.hit,true);
 assert.equal(g.previousFixedPosition,before);assert.equal(g.lastFixedPosition,last);assert.equal(g.controllerExpansionCount,1);
 assert.deepEqual(g.events.map(e=>e.type),['roll-end']);g.endRoll('cleanup');assert.equal(g.controllerExpansionCount,1);
});
test('continuous roll input and pause do not repeat or prematurely restore the collider',()=>{
 const g=empty();g.action('roll');for(let i=0;i<20;i++)g.action('roll');assert.equal(g.squeezeOwners.size,1);g.pause();g.advance(.1);
 assert.equal(g.controllerExpansionCount,0);assert.equal(g.state.player.colliderSqueezed,true);g.pause();
 for(let i=0;i<80;i++)g.advance(dt);assert.equal(g.controllerExpansionCount,1);assert.equal(g.state.player.colliderSqueezed,false);
 g.action('roll');assert.equal(g.state.player.colliderSqueezed,true);
});
test('ending beneath an impossible low blocker restores geometry and retains ordinary contact classification',()=>{
 const g=empty();g.action('roll');const e=g.addEntity(box({bottom:.5,height:2,sourceLayer:'Hit',sourceTag:'HitBarrierRoll'}));
 g.endRoll('clip-length');assert.equal(g.state.player.rollRemaining,0);assert.equal(g.state.player.colliderSqueezed,false);
 assert.equal(g.controllerProbe.overlaps.length,1);g.advance(dt);
 assert.ok(g.contacts.has(e.id),'ordinary collision dispatcher still sees expanded trigger');
 assert.equal(g.state.phase,'running','grounded Upper source branch must not become a synthetic fatal hit');
});
