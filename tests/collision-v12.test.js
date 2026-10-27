import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RunnerGame} from '../src/game-core.js';
import {SourceRouteGenerator} from '../src/route-generator.js';
import {moveControllerSwept,controllerBodyAt} from '../src/classic-controller-move.js';
import {controllerCapsule} from '../src/classic-controller.js';
import {capsuleEntitySeparation} from '../src/classic-contact.js';
const read=n=>JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+n,import.meta.url)));
const lib=read('route-library.json');lib.collisionTags=read('classic-collision-index.json');lib.modelBindings=read(lib.modelBindingsFile);
const setup=(route,speed=11)=>{const g=new RunnerGame({initialSpeed:speed,maximumSpeed:speed,acceleration:0});g.entities=[];g.nextSection=Infinity;g.start();g.collisionState.stopStumble();new SourceRouteGenerator(lib,{seed:40}).compileChunk(route,{startDistance:0,speed}).entities.forEach(e=>g.addEntity(e));g.state.distance=2;return g;};
const ramp='routes/default/chunks/normal/routechunk_default_ramp_1';
// Independent upright capsule vs axis-box oracle. It does not invoke the
// solver's distance function, and witnesses every accepted gameplay frame.
function axisBoxSeparation(p,rolling,e){const radius=.2,height=rolling?.4:.9;
 const dx=Math.max(e.x-e.width/2-p[0],0,p[0]-e.x-e.width/2),dz=Math.max(e.distance-e.depth/2-p[2],0,p[2]-e.distance-e.depth/2);
 const dy=Math.max((e.bottom??0)-(p[1]+height-radius),0,p[1]+radius-e.height);return Math.hypot(dx,dy,dz)-radius;
}
const isAxisBox=e=>e.sourceShape?.type==='box'&&e.sourceShape.rows.every((r,i)=>r.slice(0,3).every((v,j)=>i===j||Math.abs(v)<1e-9));
function verifyFrame(g){const p=g.state.player,pos=[p.x,p.y,g.state.distance];
 for(const e of g.entities.filter(e=>e.sourceIsTrigger===false&&e.sourceTag!=='Ground'&&e.sourceShape)){
  const body=controllerBodyAt(e,pos),d=isAxisBox(body)?axisBoxSeparation(pos,p.colliderSqueezed,body):capsuleEntitySeparation(controllerCapsule(pos,p.colliderSqueezed),body);
  assert.ok(d>=-1e-5,`${e.sourceTag}/${e.provenance?.collider?.pathId}: depth ${-d} at ${pos}`);
 }
}
const cases=[
 {name:'jump-shoe lower stumble at train front',route:'routes/default/chunks/easy/routechunk_default_train_tops_1',speed:11,actions:{30:'jump'},sneakers:true},
 {name:'rolling after jump-shoe front contact',route:'routes/default/chunks/easy/routechunk_default_train_tops_1',speed:11,actions:{30:'jump',45:'roll'},sneakers:true},
 {name:'diagonal front corner',route:'routes/default/chunks/easy/routechunk_default_train_tops_1',speed:22,actions:{15:'right'}},
 {name:'jump shoes into overhead',route:'routes/default/chunks/hard/routechunk_4_units_3_tracks_b-s-b',speed:22,actions:{0:'jump',15:'roll',30:'jump'},sneakers:true},
 {name:'compound ramp and side wall',route:ramp,speed:11,actions:{0:'left',15:'roll',30:'right',45:'roll'}},
];
for(const spec of cases)test(`actual route: ${spec.name} keeps physical volume outside solids`,()=>{
 const g=setup(spec.route,spec.speed);if(spec.sneakers)g.activatePowerup('sneakers');let frames=0;
 for(;frames<100&&g.state.phase==='running';frames++){if(spec.actions[frames])g.action(spec.actions[frames]);g.advance(1/120);verifyFrame(g);}
 assert.ok(frames>20);assert.ok(g.state.distance>2);
 if(spec.name.includes('front contact'))assert.ok(g.state.distance<11,'cannot keep running through the full carriage');
});
for(const speed of [11,22])for(const side of [-1,1])test(`side entry and rebound against actual ramp cap: ${speed}/${side}`,()=>{
 const g=setup(ramp,speed),p=g.state.player;g.state.distance=5;
 Object.assign(p,{x:2*side,lane:side+1,laneFrom:2*side,laneDuration:0,laneElapsed:0});g.action(side<0?'right':'left');
 for(let i=0;i<70&&g.state.phase==='running';i++){g.advance(1/120);verifyFrame(g);}
 assert.ok(g.state.distance>5);
});

test('swept front, top and corner constraints do not depend on solid array order',()=>{
 const wall={id:1,type:'train',x:0,distance:2,width:2,depth:1,height:3,bottom:0};
 const roof={id:2,type:'overhead',x:0,distance:0,width:4,depth:6,height:4,bottom:2};
 const a=moveControllerSwept([0,0,0],[.2,2,3],false,[wall,roof]),b=moveControllerSwept([0,0,0],[.2,2,3],false,[roof,wall]);
 for(let i=0;i<3;i++)assert.ok(Math.abs(a.position[i]-b.position[i])<1e-6);
 for(const e of [wall,roof])assert.ok(axisBoxSeparation(a.position,false,e)>=-1e-6);
 assert.ok(a.position[2]<1.5);assert.ok(a.position[1]<=1.10001);
});

test('separated trajectory remains unchanged; thin solids stop crossings and triggers do not',()=>{
 const e={id:1,type:'obstacle',x:0,distance:1,width:2,depth:.01,height:2,bottom:0};
 assert.deepEqual(moveControllerSwept([2,0,0],[2,0,3],false,[e]).position,[2,0,3]);
 const blocked=moveControllerSwept([0,0,0],[0,0,3],false,[e]);assert.ok(blocked.position[2]<.8);
 for(const ignored of [{...e,sourceIsTrigger:true},{...e,collisionDisabled:true}])assert.deepEqual(moveControllerSwept([0,0,0],[0,0,3],false,[ignored]).position,[0,0,3]);
});

test('moving proxy keeps its physical body and visuals tied to accepted player progress',()=>{
 const g=setup('routes/default/chunks/normal/default_1_track/routechunk_default_1_track_mid_var_1');
 const proxy=g.entities.find(e=>e.movingTrainProxy);assert.ok(proxy);
 const pos=[proxy.x,0,proxy.distance-proxy.depth/2-.5];
 const result=moveControllerSwept(pos,[pos[0],0,pos[2]+2],false,[proxy]);
 const physical=controllerBodyAt(proxy,result.position);
 assert.ok(capsuleEntitySeparation(controllerCapsule(result.position),physical)>=-1e-5);
 assert.ok(result.position[2]<pos[2]+2);
});

test('a lower brush becoming a solid frontal block crashes once rather than freezing progress',()=>{
 const g=setup('routes/default/chunks/easy/routechunk_default_train_tops_1');g.activatePowerup('sneakers');
 for(let i=0;i<150&&g.state.phase==='running';i++){if(i===30)g.action('jump');if(i===45)g.action('roll');g.advance(1/120);verifyFrame(g);}
 assert.equal(g.state.phase,'gameover');assert.equal(g.events.filter(e=>e.type==='crash').length,1);
 assert.equal(g.events.filter(e=>e.type==='critical-hit').length,1);
 assert.ok(g.state.distance<6.3,'fatal reaction happens outside the actual front');
});

test('board protection absorbs the changed frontal block without repeated persistent contacts',()=>{
 const g=setup('routes/default/chunks/easy/routechunk_default_train_tops_1');g.activatePowerup('sneakers');g.action('board');
 for(let i=0;i<130&&g.state.phase==='running';i++){if(i===30)g.action('jump');if(i===45)g.action('roll');g.advance(1/120);}
 assert.equal(g.state.phase,'running');assert.equal(g.events.filter(e=>e.type==='board-hit').length,1);
 assert.equal(g.events.filter(e=>e.type==='crash').length,0);
});

test('impossible standing clearance reports overlap instead of escaping through the ground',()=>{
 const roof={id:1,type:'obstacle',x:0,distance:0,width:4,depth:4,bottom:.5,height:2};
 const result=moveControllerSwept([0,0,0],[0,0,.1],false,[roof],{ground:0});
 assert.ok(result.position[1]>=0);assert.ok(result.overlaps.includes(1));
});
