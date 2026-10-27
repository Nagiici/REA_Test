import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { trainBodyAt } from '../src/classic-train-body.js';
import { runnerEntityContact, capsuleEntitySeparation, runnerCapsule } from '../src/classic-contact.js';
import { controllerCapsule, moveControllerLateral } from '../src/classic-controller.js';
const read=n=>JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+n,import.meta.url)));
const library=read('route-library.json');library.collisionTags=read('classic-collision-index.json');library.modelBindings=read(library.modelBindingsFile);
const generator=new SourceRouteGenerator(library,{seed:40});
const route=generator.compileChunk('routes/default/chunks/normal/default_1_track/routechunk_default_1_track_mid_var_1',
  {startDistance:100,speed:11,playerDistance:50});
const proxy=route.entities.find(e=>e.movingTrainProxy&&Math.abs(e.distance-153.75)<.01);
assert.ok(proxy,'real cargo train proxy must be present');
const game=(speed=11)=>{const g=new RunnerGame({initialSpeed:speed,maximumSpeed:speed,acceleration:0});g.entities=[];g.nextSection=1e9;g.start();return g;};

test('new end-overlap contacts classify at first entry, independently of frame endpoint',()=>{
 const e={type:'barrier',x:0,distance:.55,width:1.8,height:1.163,depth:.2};
 const g=game(22);Object.assign(g.state.player,{y:.6,velocityY:-20,grounded:false,motionGrounded:false,isJumping:true,isFalling:true});g.addEntity(e);g.advance(1/120);
 assert.equal(g.state.phase,'running');assert.ok(g.events.some(e=>e.type==='stumble'&&e.animation==='stumble_low'));
 const start=[0,.6,0],end=[0,.4319444444,22/120];
 const hit=runnerEntityContact(start,end,e,false),extended=runnerEntityContact(start,end.map((x,i)=>start[i]+2*(x-start[i])),e,false);
 assert.ok(hit.overlapping);assert.ok(hit.time<1);assert.ok(Math.abs(hit.time-2*extended.time)<1e-7);
 assert.ok(hit.position.every((v,i)=>Math.abs(v-extended.position[i])<1e-7));
});

test('actual moving train contact uses full world body, preserving source trajectory proxy',()=>{
 const original=JSON.stringify(proxy),body=trainBodyAt(proxy,148.95,148.8);
 assert.ok(Math.abs(body.depth-17.6)<1e-8);assert.ok(Math.abs(body.distance-158.55)<1e-8);
 assert.ok(capsuleEntitySeparation(runnerCapsule([0,0,148.95],false),body)>.39);
 assert.ok(Math.abs(capsuleEntitySeparation(runnerCapsule([0,0,149.15],false),trainBodyAt(proxy,149.15)))<1e-7);
 assert.equal(JSON.stringify(proxy),original);
 assert.equal(body.movingTrainProxy.motionId,proxy.movingTrainProxy.motionId);
 // Authored body front is .101 behind this recovered mesh's front; it must
 // not fire .299 before the rendered cargo as the compressed proxy did.
 const mesh=read('MexicoCity_train_cargo_train_cargo.json');
 const localMin=Math.min(...mesh.positions.map(p=>p[2]))*.1;
 const visual=route.entities.find(e=>e.visual&&e.motionId===proxy.movingTrainProxy.motionId);
 const visualFront=visual.movingTrain.initialDistance-(149.15-visual.movingTrain.referencePlayerDistance)*visual.movingTrain.ratio+localMin;
 assert.ok(visualFront<149.15+.4);
});

for(const speed of [11,16.5,22]) test(`moving train does not kill across empty space at speed ${speed}`,()=>{
 const g=game(speed);g.addEntity(proxy);g.state.distance=148.9;g.advance(1/120);
 assert.equal(g.state.phase,'running');
 for(let i=0;i<10&&g.state.phase==='running';i++)g.advance(1/120);
 assert.equal(g.state.phase,'gameover');assert.ok(g.state.distance>=149.15-1e-7);
 assert.ok(g.state.distance<=149.15+speed/120+1e-7,'contact still occurs within the crossing tick');
});

test('actual moving train supports the entire roof and releases beyond the moving rear edge',()=>{
 const g=game();g.entities=[proxy];let count=0;
 for(let p=149.5;p<158;p+=.025){assert.ok(Math.abs(g.surfaceHeight(p,0,3.1)-2.92)<1e-7);count++;}
 assert.ok(count>330);assert.equal(g.surfaceHeight(158.3,0,3.1),0);
 // This was an extra .2-long shelf in the compressed body, not real support.
 assert.equal(g.surfaceHeight(149.2,0,3.1),0);
});

for(const speed of [11,22]) for(const moving of [false,true]) test(`descending roof landing remains solid (${speed}, moving=${moving})`,()=>{
 const g=game(speed);g.state.distance=153.75;
 const source=moving?proxy:{...trainBodyAt(proxy,153.75),movingTrainProxy:undefined};
 const e=g.addEntity(source),p=g.state.player;
 Object.assign(p,{y:3.02,velocityY:-4,grounded:false,motionGrounded:false,isJumping:true});
 for(let i=0;i<12;i++){
  g.advance(1/120);assert.equal(g.state.phase,'running');
  assert.ok(capsuleEntitySeparation(controllerCapsule([p.x,p.y,g.state.distance]),trainBodyAt(e,g.state.distance))>=-1e-7);
 }
 assert.equal(p.y,2.92);assert.ok(p.grounded);
});

for(const sign of [-1,1]) test(`below-roof lane entry cannot penetrate train side (${sign})`,()=>{
 const e={...trainBodyAt(proxy,153.75),movingTrainProxy:undefined};
 const y=2.65,z=153.75;
 let x=sign*1.3;
 for(let i=0;i<30;i++){
  const move=moveControllerLateral([x,y,z],-sign*.12,false,[e]);x=move.x;
  assert.ok(capsuleEntitySeparation(controllerCapsule([x,y,z]),e)>=-1e-7);
 }
 assert.ok(Math.abs(x)>e.width/2,'foot stays outside side wall');
 const exit=moveControllerLateral([x,y,z],sign*.2,false,[e]);assert.equal(exit.blocked,false);
 const roof=moveControllerLateral([sign*1.3,e.height,z],-sign*1.3,false,[e]);assert.ok(Math.abs(roof.x)<1e-7);
});

test('sustained gameplay side entry blocks even when Enter was already delivered',()=>{
 const g=game(),p=g.state.player;g.state.distance=153.75;
 const e=g.addEntity({...trainBodyAt(proxy,153.75),movingTrainProxy:undefined});
 Object.assign(p,{x:1.1,laneFrom:1.1,lane:1,laneDuration:.2,y:2.65,velocityY:-1,grounded:false,motionGrounded:false});
 g.contacts.add(e.id); // No second Enter to rescue the incomplete physical move.
 for(let i=0;i<12;i++){
  g.advance(1/120);assert.equal(g.state.phase,'running');
  assert.ok(capsuleEntitySeparation(controllerCapsule([p.x,p.y,g.state.distance]),e)>=-1e-7);
 }
 assert.ok(p.x>=1.05-1e-7);
});

test('disabled solids, pickups and source triggers never become physical lane walls',()=>{
 const solid={type:'train',x:0,distance:0,width:2,depth:10,bottom:0,height:3};
 for(const e of [{...solid,collisionDisabled:true},{...solid,sourceIsTrigger:true},{...solid,type:'coin'}])
  assert.equal(moveControllerLateral([2,0,0],-3,false,[e]).x,-1);
});
