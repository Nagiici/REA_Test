import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RunnerGame, sourceVerticalBounds } from '../src/game-core.js';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { PlayerMotion } from '../src/player-motion.js';
import { ClassicCamera } from '../src/classic-camera.js';
const dt=1/120, tick=g=>g.advance(dt);
function empty(config={}) { const g=new RunnerGame({acceleration:0,...config});g.entities=[];g.nextSection=1e9;g.start();g.drainEvents();return g; }
const actor={clipDurations:{jump:.8,hangtime:.7,landing:.2,dodge_left:.5,run:.4}};

test('walk-off keeps observable ground until Hangtime; lane context captures it at input time',()=>{
 const g=empty(),p=g.state.player;g.addEntity({type:'gap',x:0,width:10,distance:0,depth:30,floor:false});
 tick(g);assert.equal(p.grounded,false);assert.equal(p.motionGrounded,true);
 g.action('left');const lane=g.drainEvents().find(e=>e.type==='lane');assert.equal(lane.motion.grounded,true);
 for(let i=0;i<8;i++)tick(g);assert.equal(p.motionGrounded,false);assert.equal(g.events.filter(e=>e.type==='hangtime').length,1);
 assert.equal(lane.motion.grounded,true,'later fall cannot change earlier callback context');
});
test('physical support frame preserves air pose and camera factor until the landing notification',()=>{
 const g=empty(),p=g.state.player,m=new PlayerMotion({hangtime:['hangtime']}),camera=new ClassicCamera();
 Object.assign(p,{y:.01,velocityY:-8,grounded:false,motionGrounded:false,isJumping:true,isFalling:true});
 m.select(g.state,[{type:'hangtime'}],actor);tick(g);
 assert.equal(p.grounded,true);assert.equal(p.motionGrounded,false);
 assert.equal(m.select(g.state,g.drainEvents(),actor).name,'hangtime');
 camera.lastDeltaYFactor=.7;camera.step(dt,{position:[0,p.y,0],grounded:p.motionGrounded});
 assert.ok(camera.lastDeltaYFactor>0,'support alone must not snap the airborne camera factor');
 tick(g);assert.equal(p.motionGrounded,true);assert.equal(m.select(g.state,g.drainEvents(),actor).name,'landing');
 camera.step(dt,{position:[0,p.y,0],grounded:p.motionGrounded});assert.equal(camera.lastDeltaYFactor,0);
});
test('quiet support publishes ground without clearing ceiling state or inventing landing',()=>{
 const g=empty(),p=g.state.player;p.velocityY=-.2;p.motionGrounded=false;
 g.ceiling={hit:true,minY:9,evaded:false};tick(g);
 assert.equal(p.motionGrounded,true);assert.equal(g.ceiling.hit,true);assert.equal(g.ceiling.evaded,false);
 assert.equal(g.events.some(e=>e.type==='land'),false);
 p.isFalling=true;tick(g);assert.equal(g.ceiling.hit,false);assert.equal(g.ceiling.evaded,true);
 assert.equal(g.events.filter(e=>e.type==='land').length,1);
});
test('jump acceptance still uses physical contact, including the pre-notification landing frame',()=>{
 const g=empty(),p=g.state.player;Object.assign(p,{grounded:true,motionGrounded:false,isJumping:true,velocityY:-8});
 assert.equal(g.action('jump'),true);assert.equal(p.motionGrounded,false);assert.equal(p.grounded,false);
});
test('lower-contact-style hop does not synthesize a jump or immediately change observable ground',()=>{
 const g=empty(),p=g.state.player;Object.assign(p,{velocityY:Math.sqrt(2*20*.15),grounded:false});
 tick(g);assert.equal(p.motionGrounded,true);assert.equal(p.isJumping,false);assert.equal(g.events.length,0);
 for(let i=0;i<40&&!p.isFalling;i++)tick(g);
 assert.equal(p.motionGrounded,false);assert.equal(g.events.some(e=>e.type==='jump'),false);
});
test('explicit revive Jump survives an unchanged true observable and is replaced only by landing',()=>{
 const g=empty(),m=new PlayerMotion(),p=g.state.player;
 Object.assign(p,{grounded:false,motionGrounded:true,isJumping:true,velocityY:6});
 assert.equal(m.select(g.state,[{type:'board-revive'}],actor).name,'jump');
 assert.equal(m.select(g.state,[],actor).name,'jump');
 assert.equal(m.select(g.state,[{type:'land',velocityY:-2,rolling:false}],actor).name,'run');
});
test('jetpack publishes airborne and repeated roll does not create a new observable transition',()=>{
 const g=empty(),p=g.state.player;g.action('roll');g.action('roll');assert.equal(p.motionGrounded,true);
 g.activatePowerup('jetpack');assert.equal(p.motionGrounded,false);
 g.state.distance=g.state.flight.targetZ+1;g.advance(dt);assert.equal(p.motionGrounded,false);
});

const read=n=>JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+n,import.meta.url)));
const library=read('route-library.json');library.collisionTags=read('classic-collision-index.json');
const generator=new SourceRouteGenerator(library,{seed:40});
const fixtures=new Map();
for(const id of Object.keys(library.routes))for(const e of generator.compileChunk(id,{startDistance:100,speed:11}).entities)
 if(e.type==='obstacle'&&!e.sourceIsTrigger&&['HitStationPlatform','HitBarrierJump','HitBlocker'].includes(e.sourceTag)&&!fixtures.has(e.sourceTag))fixtures.set(e.sourceTag,e);
for(const tag of ['HitStationPlatform','HitBarrierJump','HitBlocker'])test(`recovered ${tag} supports a descent from above, not a front climb`,()=>{
 const source=fixtures.get(tag);assert.ok(source);const g=empty({initialSpeed:0}),e=g.addEntity({...source,x:0,distance:0}),p=g.state.player;
 const top=sourceVerticalBounds(e,0,0).top;Object.assign(p,{y:top+.01,velocityY:-5,grounded:false,motionGrounded:false,isFalling:true});
 tick(g);assert.equal(p.y,top);assert.equal(p.grounded,true);assert.equal(g.state.phase,'running');
 tick(g);assert.equal(p.motionGrounded,true);assert.equal(g.events.filter(e=>e.type==='land').length,1);
 assert.equal(g.surfaceHeight(0,0,top-.001),0,'no tolerance-based step through the front face');
 assert.equal(g.surfaceHeight(0,e.width/2+.001,top+1),0,'outside the source face is unsupported');
 e.sourceIsTrigger=true;assert.equal(g.surfaceHeight(0,0,top+1),0);
 e.sourceIsTrigger=false;e.collisionDisabled=true;assert.equal(g.surfaceHeight(0,0,top+1),0);
});
test('recovered platform front remains fatal while landing on top is safe',()=>{
 const g=empty(),e=g.addEntity({...fixtures.get('HitStationPlatform'),x:0,distance:0});
 e.distance=e.depth/2+.4;tick(g);assert.equal(g.state.phase,'gameover');assert.equal(g.state.player.y,0);
});
test('walking beyond a source platform end releases support and emits one Hangtime',()=>{
 const g=empty(),source=fixtures.get('HitStationPlatform'),e=g.addEntity({...source,x:0,distance:0}),p=g.state.player;
 const top=sourceVerticalBounds(e,0,0).top;g.state.distance=e.depth/2-.05;Object.assign(p,{y:top,velocityY:-.2,lastGroundedY:top});
 tick(g);assert.equal(p.grounded,false);assert.equal(p.motionGrounded,true);
 for(let i=0;i<10;i++)tick(g);assert.equal(p.motionGrounded,false);assert.equal(g.events.filter(e=>e.type==='hangtime').length,1);
});
