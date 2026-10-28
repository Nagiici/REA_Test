import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SourceRouteGenerator } from '../src/route-generator.js';
import { ClassicRouteQueue } from '../src/route-queue.js';
const library = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/route-library.json',import.meta.url)));
const make = seed => { const source = new SourceRouteGenerator(library,{seed}); return {source,queue:new ClassicRouteQueue(source, chunk => chunk, { now: () => 0 })}; };
const context = (playerDistance=0) => ({playerDistance,speed:22,elapsed:0});

test('prefab spawning is separate from construction; exact build horizon is exclusive',()=>{
 const {source,queue}=make(5);const built=queue.update(context(),{prime:true});
 assert.ok(queue.spawnedEdge>=200);assert.ok(queue.chunks.some(c=>!c.built));
 assert.equal(source.compilationCount,built.length);
 const pending=queue.chunks.find(c=>!c.built),count=source.compilationCount;
 assert.equal(pending.plan.entities.length,0);assert.ok(pending.plan.deferred);
 queue.update(context(pending.startDistance-90));assert.equal(pending.built,false);
 assert.equal(source.compilationCount,count,'selectors must not run while descriptor is only queued');
 queue.update(context(pending.startDistance-90+.001));assert.equal(pending.built,true);
 assert.ok(source.compilationCount>count);
});

test('ordinary update spawns at most one chunk and preserves the menu 200-unit spawn horizon',()=>{
 const {queue}=make(6);queue.update(context());assert.equal(queue.chunks.length,1);
 const edge=queue.spawnedEdge;queue.update(context());assert.ok(queue.spawnedEdge>edge);
 while(queue.spawnedEdge<200)queue.update(context());
 const end=queue.spawnedEdge;queue.update(context());assert.equal(queue.spawnedEdge,end);
 queue.update(context(end-200+.001));assert.ok(queue.spawnedEdge>end);
});

test('strict directive rolls back complete unbuilt sections without rerolling built content or refunding history',()=>{
 const {source,queue}=make(5);queue.update(context(),{prime:true});
 const built=queue.chunks.filter(c=>c.built),count=source.sectionCount;
 const repeats=structuredClone(source.sectionStates),previous=source.lastSection;
 const unbuilt=queue.sections.find(s=>!s.firstBuilt);
 assert.ok(unbuilt);const target=unbuilt.startDistance;
 const result=queue.enqueueJetpackLanding(target);assert.equal(result.accepted,true);
 assert.ok(queue.events.some(e=>e.type==='rollback-unbuilt-section'));
 assert.deepEqual(queue.chunks.filter(c=>c.built),built);
 assert.equal(source.sectionCount,count);assert.deepEqual(source.sectionStates,repeats);assert.equal(source.lastSection,previous);
 assert.equal(queue.spawnedEdge,target);
 queue.update(context(target));
 assert.ok(queue.chunks.some(c=>c.startDistance===target&&c.plan.provenance.jetpackLanding?.kind==='landing'));
});

test('strict insertion cannot erase a built section or shift an off-grid target',()=>{
 const {queue}=make(9);queue.update(context(),{prime:true});
 assert.equal(queue.enqueueJetpackLanding(12.3).reason,'off-grid');
 const built=queue.chunks.filter(c=>c.built);
 assert.equal(queue.enqueueJetpackLanding(18).reason,'built-section-boundary');
 assert.deepEqual(queue.chunks.filter(c=>c.built),built);
});

test('several pending directives retain their own exact landing positions and ordinary content resumes',()=>{
 const {queue}=make(4);queue.update(context(),{prime:true});
 for(const target of [414,630,846])assert.equal(queue.enqueueJetpackLanding(target).accepted,true);
 const emitted=[];
 for(let z=0;z<930;z+=2)emitted.push(...queue.update(context(z)));
 const landings=emitted.filter(c=>c.provenance.jetpackLanding?.kind==='landing');
 assert.deepEqual(landings.map(c=>c.provenance.queue.startDistance),[414,630,846]);
 assert.ok(landings.every(c=>c.length===18));
 assert.ok(emitted.every(c=>c.provenance.jetpackLanding?.kind!=='landing-safety-padding'));
 assert.ok(emitted.some(c=>c.provenance.queue.startDistance===864&&!c.provenance.jetpackLanding));
 assert.equal(queue.directives.length,0);
 assert.ok(!queue.events.some(e=>e.type==='missed-strict-landing'));
 assert.ok(queue.chunks.length<30,'despawn passed descriptors instead of accumulating the whole run');
});

test('a subsequent flight cannot replay the consumed landing section after restoring currentSection',()=>{
 const {queue}=make(5);queue.update(context(),{prime:true});
 assert.equal(queue.enqueueJetpackLanding(234).accepted,true);
 while(queue.spawnedEdge<=234)queue.update(context(60));
 const first=queue.chunks.find(c=>c.startDistance===234);
 assert.equal(first.plan.section.phase,3);assert.equal(first.plan.section.middleUsed,1);
 assert.equal(queue.enqueueJetpackLanding(450).accepted,true);
 const emitted=[];for(let z=60;z<470;z+=2)emitted.push(...queue.update(context(z)));
 const after=emitted.find(c=>c.provenance.queue.startDistance===252);
 assert.ok(after);assert.notEqual(after.provenance.chunkId,'routes/default/chunks/routechunk_default_jetpack_landing');
 assert.equal(emitted.filter(c=>c.provenance.jetpackLanding?.kind==='landing').length,2);
});

test('a directive at the cursor creates its section before the next chunk enters the spawn horizon',()=>{
 const {source,queue}=make(5);queue.update(context(),{prime:true});
 const edge=queue.spawnedEdge,count=source.sectionCount;
 assert.equal(queue.enqueueJetpackLanding(edge).accepted,true);
 queue.update(context());assert.equal(queue.spawnedEdge,edge);
 assert.equal(source.sectionCount,count+1);assert.equal(queue.minimumJetpackLandingZ,edge+18);
 queue.update(context());assert.equal(source.sectionCount,count+1,'waiting does not repeatedly Reset the section');
 queue.update(context(edge-200+.001));assert.equal(queue.spawnedEdge,edge+18);
 assert.equal(source.sectionCount,count+1,'spawning consumes the existing forced section');
});

test('real selection work remains pending across budgeted updates while IsBuilt protects the section from rollback',()=>{
 let time=0;const source=new SourceRouteGenerator(library,{seed:5});
 const queue=new ClassicRouteQueue(source,c=>c,{now:()=>time+=10});
 queue.update(context(),{prime:true});
 const pending=queue.chunks.find(c=>!c.built),z=pending.startDistance-85;
 const previousReady=queue.readyEdge;
 queue.update(context(z));assert.equal(pending.built,true);assert.equal(pending.ready,false);
 assert.equal(queue.readyEdge,previousReady);
 assert.ok(queue.worker.spawn.length>0);
 assert.equal(queue.enqueueJetpackLanding(pending.startDistance).accepted,false);
 assert.ok(queue.chunks.includes(pending),'built but unfinished chunks cannot be rolled back');
 let emitted=[];for(let i=0;i<500&&!pending.ready;i++)emitted.push(...queue.update(context(z)));
 assert.equal(pending.ready,true);assert.ok(emitted.some(c=>c.provenance.queue.id===pending.id));
 assert.ok(emitted.some(c=>c.decisions.length>0));
});
