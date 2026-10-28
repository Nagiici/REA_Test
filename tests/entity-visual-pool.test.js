import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EntityVisualPool } from '../src/entity-visual-pool.js';
const entity={type:'decoration',visual:{prefabKey:'train',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}};
const factory=()=>{const g=new THREE.Group(),child=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());child.position.y=3;g.add(child);return g;};
test('visual reuse restores root/descendant transforms and visibility, without allocating collision-only scene nodes',()=>{
 const pool=new EntityVisualPool(factory);assert.equal(pool.acquire({visual:null}),null);
 const object=pool.acquire(entity),parent=new THREE.Group();parent.add(object);
 object.position.set(30,1,200);object.rotation.y=2;object.children[0].rotation.y=5;object.children[0].visible=false;
 pool.release(object);assert.equal(object.parent,null);
 const reused=pool.acquire(entity);assert.equal(reused,object);assert.deepEqual(reused.position.toArray(),[0,0,0]);
 assert.equal(reused.rotation.y,0);assert.equal(reused.children[0].rotation.y,0);assert.equal(reused.children[0].position.y,3);
 assert.equal(reused.children[0].visible,true);assert.equal(pool.stats.created,1);assert.equal(pool.stats.reused,1);
});
test('pool has total/per-prefab bounds and different transform descriptors cannot reuse a mismatched model',()=>{
 const pool=new EntityVisualPool(factory,{maxTotal:3,maxPerKey:2});const all=Array.from({length:9},()=>pool.acquire(entity));
 for(const object of all)pool.release(object);assert.equal(pool.stats.retained,2);assert.equal(pool.stats.discarded,7);
 pool.release(all[0]);assert.equal(pool.stats.retained,2);
 const b=pool.acquire({...entity,visual:{...entity.visual,placeholderRoot:true}});assert.ok(!all.includes(b));
 pool.release(b);assert.equal(pool.stats.retained,3);
 for(let i=0;i<1000;i++){const object=pool.acquire(entity);pool.release(object);}
 assert.equal(pool.stats.created,10);assert.ok(pool.stats.retained<=3);
});
