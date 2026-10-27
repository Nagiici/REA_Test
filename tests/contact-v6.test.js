import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Matrix4 } from 'three';
import { RunnerGame } from '../src/game-core.js';
import { capsuleEntitySeparation, runnerCapsule, runnerEntityContact, overlapsRunnerEntity } from '../src/classic-contact.js';
import { SourceRouteGenerator, colliderBounds, colliderShape } from '../src/route-generator.js';

const box = { x: 0, distance: 0, width: 2, depth: 2, bottom: 0, height: 2 };
const state = (x,y,z,roll=0) => ({ distance:z,player:{x,y,rollRemaining:roll} });

test('rounded capsule corners reject false rectangular contacts, including the rolling sphere', () => {
  assert.equal(overlapsRunnerEntity(state(1.25,0,1.15),box),false);
  assert.equal(overlapsRunnerEntity(state(1.2,0,1.1),box),true);
  const bar={...box,bottom:.68};
  assert.equal(overlapsRunnerEntity(state(1.2,0,0,1),bar),false);
  assert.equal(overlapsRunnerEntity(state(1.2,0,0),bar),true);
  assert.equal(overlapsRunnerEntity(state(0,0,0,1),{...bar,bottom:.70001}),false);
  assert.equal(overlapsRunnerEntity(state(0,0,0,1),{...bar,bottom:.69999}),true);
});

test('rotated original boxes and tilted capsules retain their true surfaces', () => {
  const fields={m_Size:{x:20,y:20,z:20},m_Center:{x:0,y:0,z:0}};
  const matrix=new Matrix4().makeRotationY(Math.PI/4), bounds=colliderBounds(fields,matrix);
  const e={...bounds,sourceShape:colliderShape(fields,matrix,bounds)};
  assert.equal(overlapsRunnerEntity(state(1.3,0,1.2),e),false);
  assert.equal(overlapsRunnerEntity(state(0,0,0),e),true);
  const capsule={...box,x:0,distance:0,width:2,depth:6,bottom:-1,height:1,
    sourceShape:{type:'capsule',rows:[[10,0,0,0],[0,0,10,0],[0,-10,0,0]],radius:10,halfSegment:20,axis:1}};
  assert.ok(capsuleEntitySeparation(runnerCapsule([1.25,0,2.4],false),capsule)>0);
  assert.ok(capsuleEntitySeparation(runnerCapsule([0,0,2.4],false),capsule)<0);
});

test('swept relative contacts catch thin walls and fast falls without reporting distant corners', () => {
  const thin={...box,depth:.01};
  const hit=runnerEntityContact([0,0,-2],[0,0,2],thin,false);
  assert.ok(hit && hit.time>0 && hit.time<1);assert.equal(hit.overlapping,false);
  assert.equal(runnerEntityContact([1.31,0,-2],[1.31,0,2],thin,false),null);
  const ledge={...box,bottom:1,height:1.01};
  assert.ok(runnerEntityContact([0,2,0],[0,-1,0],ledge,true));
  const crossing={...thin,previousDistance:2,distance:-2};
  assert.ok(runnerEntityContact([0,0,0],[0,0,0],crossing,false));
  assert.equal(runnerEntityContact([0,0,-3],[0,0,1],{...thin,previousDistance:0,distance:4},false),null);
});

test('leaving an existing overlap does not synthesize another trigger entry', () => {
  assert.equal(runnerEntityContact([0,0,0],[0,0,3],box,false),null);
  const hit=runnerEntityContact([0,0,-3],[0,0,0],box,false);
  assert.equal(hit.overlapping,true);assert.ok(Math.abs(hit.time - 1.6 / 3) < 1e-7);
});

test('gameplay uses capsule narrow phase before applying source AABB hit classification', () => {
  function game(x){const g=new RunnerGame({acceleration:0,initialSpeed:11});g.entities=[];g.nextSection=1e9;g.start();
    Object.assign(g.state.player,{x,laneFrom:x,laneDuration:1e9});return g;}
  const miss=game(1.25),hit=game(0);
  for(const g of [miss,hit]){g.state.distance=1.05;g.addEntity({...box,type:'obstacle',sourceLayer:'Hit',sourceIsTrigger:true});g.advance(1/120);}
  assert.equal(miss.events.some(e=>e.type==='stumble'),false);
  assert.equal(hit.events.some(e=>e.type==='stumble'),true);
});

test('actual default route collider transforms support precise box/capsule contact without fallback', () => {
  const read=n=>JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+n,import.meta.url)));
  const library=read('route-library.json');library.collisionTags=read('classic-collision-index.json');library.modelBindings=read(library.modelBindingsFile);
  const generator=new SourceRouteGenerator(library,{seed:40});let boxes=0,capsules=0;
  for(const id of Object.keys(library.routes)) for(const e of generator.compileChunk(id,{startDistance:100,speed:11}).entities){
    const shape=e.sourceShape;if(!shape)continue;const norms=shape.rows.map(row=>Math.hypot(...row.slice(0,3)));
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.abs(shape.rows[i].slice(0,3).reduce((sum,v,k)=>sum+v*shape.rows[j][k],0)/norms[i]/norms[j])<1e-6);
    if(shape.type==='capsule'){capsules++;assert.ok(Math.max(...norms)/Math.min(...norms)<1+1e-6);}else boxes++;
  }
  assert.ok(boxes>400);assert.ok(capsules>=30);
});
