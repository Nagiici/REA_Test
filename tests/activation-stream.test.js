import { RunnerGame } from '../src/game-core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { EnvironmentRouteGenerator } from '../src/environment-layout.js';
import { RouteWork } from '../src/route-worker.js';
const root=new URL('../public/assets/recovered/',import.meta.url),read=n=>JSON.parse(fs.readFileSync(new URL(n,root)));
const library=read('route-library.json');library.modelBindings=read(library.modelBindingsFile);
const bindings=read(read('manifest.json').environmentBindings);
const moving='routes/default/chunks/normal/routechunk_default_train_tops_moving';

test('real prefab groups publish before chunk completion, with their model and physical body in the same activation',()=>{
 const source=new SourceRouteGenerator(library,{seed:1}),groups=[];
 let frame=0;const context=()=>({startDistance:108,playerDistance:18+frame/100,speed:22,levelSpeed:22});
 const work=new RouteWork(source.compileChunkWork(moving,context,b=>groups.push({...b,frame,finished:work.done})));
 while(!work.done){work.step();frame++;assert.ok(frame<10000);}
 const entities=groups.flatMap(b=>b.entities);
 assert.equal(entities.length,work.value.entities.length);assert.equal(new Set(entities).size,entities.length);
 assert.deepEqual(new Set(entities),new Set(work.value.entities));
 const physical=groups.filter(b=>b.entities.some(e=>e.type==='train'));
 assert.ok(physical.length>1);assert.ok(physical.every(b=>b.entities.some(e=>e.visual)));
 assert.ok(physical.every(b=>b.finished===false));
 const movingGroups=physical.filter(b=>b.entities.some(e=>e.movingTrain));assert.ok(movingGroups.length);
 for(const batch of movingGroups){
  assert.ok(batch.entities.some(e=>e.movingTrainProxy));
  for(const e of batch.entities.filter(e=>e.movingTrain)) assert.equal(e.movingTrain.referencePlayerDistance,batch.playerDistance);
 }
 assert.ok(new Set(movingGroups.map(b=>b.playerDistance)).size>1,'later prefabs sample their own activation frame');
});

test('Mirror-created runtime TrackObjects participate in hierarchy activation before child geometry emits',()=>{
 const source=new SourceRouteGenerator(library,{seed:1});
 const chunk=source.compileChunk('routes/default/chunks/easy/routechunk_default_b-s-b',{speed:22});
 const mirrors=chunk.decisions.filter(d=>d.type==='Mirror');assert.equal(mirrors.length,2);
 assert.ok(mirrors.some(d=>d.sign===-1));
 const model=chunk.entities.find(e=>e.visual?.prefabKey==='MexicoCity_blocker_jump'&&e.provenance.graph.includes('/182:'));
 assert.ok(model);assert.equal(model.x,2,'implicit mirror activation restores source-selected lane');
});

test('route worker completion does not flush CoinCurve rows: level speed controls count and each row progresses once per Update',()=>{
 const source=new SourceRouteGenerator(library,{seed:1});
 new RouteWork(source.compileChunkWork(moving,()=>({startDistance:108,playerDistance:0,speed:70,levelSpeed:11,
   deferCoins:true,routeChunkId:1,endDistance:180}))).finish();
 assert.ok(source.coinRows.rows.size>0);
 const rows=[...source.coinRows.rows.values()];assert.ok(rows.every(row=>row.index===-1));
 const first=source.coinRows.update({playerDistance:1,levelSpeed:11,speed:70});
 assert.ok(first.length<=rows.length);assert.ok(first.every(e=>e.coinCurve.rule.nativeSpeed===110));
 assert.ok([...source.coinRows.rows.values()].every(row=>row.index===0));
});

test('2000 route updates retire streamed groups and row producers, keeping live ownership bounded',t=>{
 const route=new EnvironmentRouteGenerator(new SourceRouteGenerator(library,{seed:40}),bindings,{workerOptions:{now:()=>0}});
 let active=[],maxEntities=0,maxRows=0,total=0;
 for(let i=0;i<2000;i++){
  const z=i*2;route.updateCourse({playerDistance:z,speed:22,levelSpeed:22},{prime:i===0});
  const retired=new Set(route.drainRetirements());active=active.filter(e=>!retired.has(e.routeActivation.key));
  const fresh=route.drainActivations().filter(e=>!retired.has(e.routeActivation.key));active.push(...fresh);total+=fresh.length;
  maxEntities=Math.max(maxEntities,active.length);maxRows=Math.max(maxRows,route.source.coinRows.rows.size);
  assert.ok(route.queue.chunks.length<40);assert.ok(active.length<6000);assert.ok(route.source.coinRows.rows.size<600);
 }
 t.diagnostic(JSON.stringify({total,maxEntities,maxRows}));assert.ok(total>maxEntities*5);assert.ok(maxEntities>100);assert.ok(maxRows>0);
 route.reset(40);assert.equal(route.source.coinRows.rows.size,0);assert.equal(route.drainActivations().length,0);
});


test('Mirror reuses a serialized sibling TrackObject instead of creating duplicate activation owners',()=>{
 const source=new SourceRouteGenerator(library),graph=source.resolveChunk('routes/default/chunks/easy/routechunk_default_s-s-s-s');
 const result={decisions:[]},instance=source.createInstance(graph,'fixture',false,result);
 const both=graph.nodes.filter(node=>node.scripts.some(s=>s.class==='Mirror')&&node.scripts.some(s=>s.class==='TrackObject'));
 assert.equal(both.length,3);
 for(const node of both){const tracks=instance.trackObjects.filter(t=>t.node===node);assert.equal(tracks.length,1);
  assert.equal(tracks[0].script.class,'TrackObject');assert.equal(source.trackOwner(instance,node),tracks[0].script.id);}
});


test('menu Updates prepare coin rows without advancing player physics; pausing a run freezes those producers',()=>{
 const g=new RunnerGame();g.setRouteGenerator(new EnvironmentRouteGenerator(new SourceRouteGenerator(library,{seed:1}),bindings,{workerOptions:{now:()=>0}}));
 assert.equal(g.state.phase,'ready');assert.equal(g.entities.filter(e=>e.coinCurve).length,0);
 g.advance(1/60);assert.ok(g.entities.some(e=>e.coinCurve));assert.equal(g.state.distance,0);
 g.start();g.pause();const indexes=[...g.routeGenerator.source.coinRows.rows.values()].map(r=>r.index);
 g.advance(1/60);assert.deepEqual([...g.routeGenerator.source.coinRows.rows.values()].map(r=>r.index),indexes);
});
