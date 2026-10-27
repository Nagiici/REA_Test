import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {SourceRouteGenerator} from '../src/route-generator.js';
import {prefabFromUnity} from '../src/asset-adapter.js';
import {createEntityVisual} from '../src/entity-visuals.js';
import {trainBodyAt} from '../src/classic-train-body.js';
const read=n=>JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/'+n,import.meta.url)));
const library=read('route-library.json');library.collisionTags=read('classic-collision-index.json');library.modelBindings=read(library.modelBindingsFile);
const manifest=read('manifest.json'),prefabData={},templates={},meshes={};
for(const key of new Set(Object.values(library.modelBindings.byDefinitionRef).map(b=>b.prefabKey))){
 const data=prefabData[key]=read(manifest.prefabs[key].file);
 for(const n of data.nodes)if(n.mesh&&!meshes[n.mesh])meshes[n.mesh]=read(manifest.meshes[n.mesh].file);
 templates[key]=prefabFromUnity(data,meshes,{},manifest);
}
const pack={prefabData,clonePrefab:key=>templates[key].clone(true)};
function visibleBounds(object){
 const bounds=new THREE.Box3();object.updateMatrixWorld(true);
 object.traverse(node=>{if(!node.isMesh)return;for(let p=node;p;p=p.parent)if(!p.visible)return;
  const materials=Array.isArray(node.material)?node.material:[node.material];
  if(!materials.some(m=>m.visible&&(!m.transparent||m.opacity>0)))return;
  node.geometry.computeBoundingBox();bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
 });return bounds;
}

test('49 classic routes retain provenance-paired model/collider overlap, including moving train snapshots',()=>{
 let groups=0,moving=0;const keys=new Set(),tags=new Set();
 for(const route of Object.keys(library.routes)){
  const chunk=new SourceRouteGenerator(library,{seed:40}).compileChunk(route,{startDistance:100,speed:11,playerDistance:50});
  const pairs=new Map();
  for(const e of chunk.entities.filter(e=>e.sourceShape&&!e.sourceIsTrigger)){
   const graph=e.provenance.graph;if(!pairs.has(graph))pairs.set(graph,{solids:[],visuals:[]});pairs.get(graph).solids.push(e);tags.add(e.sourceTag);
  }
  for(const e of chunk.entities.filter(e=>e.visual?.prefabKey&&templates[e.visual.prefabKey])){
   const match=[...pairs.keys()].filter(k=>e.provenance.graph===k||e.provenance.graph.startsWith(k+'/')).sort((a,b)=>b.length-a.length)[0];
   if(!match){assert.match(route,/\/routechunk_default_no_gameplay_(1|2|epic)$/,'unexpected unsupported visual');continue;}
   pairs.get(match).visuals.push(e);keys.add(e.visual.prefabKey);
  }
  for(const pair of pairs.values()){
   if(!pair.visuals.length)continue;groups++;
   const movingPair=pair.solids.some(e=>e.movingTrainProxy);if(movingPair)moving++;
   for(const progress of movingPair?[50,100,150]:[50]){
    const solidBounds=new THREE.Box3(),meshBounds=new THREE.Box3();
    for(const e of pair.solids){const b=trainBodyAt(e,progress);solidBounds.union(new THREE.Box3(new THREE.Vector3(b.x-b.width/2,b.bottom,-b.distance-b.depth/2),new THREE.Vector3(b.x+b.width/2,b.height,-b.distance+b.depth/2)));}
    for(const e of pair.visuals){const object=createEntityVisual(e,pack);let z=e.distance;if(e.movingTrain)z=e.movingTrain.initialDistance-(progress-e.movingTrain.referencePlayerDistance)*e.movingTrain.ratio;object.position.set(e.x,0,-z);meshBounds.union(visibleBounds(object));}
    assert.ok(meshBounds.intersectsBox(solidBounds),`${route}/${pair.visuals[0].visual.prefabKey} misplaced at ${progress}`);
   }
  }
 }
 assert.ok(groups>300);assert.ok(moving>60);assert.ok(keys.size>=10);
 for(const tag of ['HitTrain','HitMovingTrain','HitBarrierRoll','HitBarrierJump','HitBarrierStandard','HitStationPlatform','HitPillar','HitGates'])assert.ok(tags.has(tag),tag);
});
