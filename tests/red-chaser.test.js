import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {characterFromGLB} from '../src/asset-adapter.js';
import {createChaserPresentation} from '../src/chaser-presentation.js';
import {RunnerGame} from '../src/game-core.js';
const bytes=fs.readFileSync(new URL('../public/assets/character/red-nose-chaser.glb',import.meta.url)),length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length));
const report=JSON.parse(fs.readFileSync(new URL('../public/assets/character/red-nose-chaser.json',import.meta.url)));
async function load(){const d=structuredClone(doc);delete d.materials;delete d.textures;delete d.images;delete d.samplers;for(const m of d.meshes)for(const p of m.primitives)delete p.material;let j=Buffer.from(JSON.stringify(d));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const binary=bytes.subarray(20+length),h=Buffer.from(bytes.subarray(0,20));h.writeUInt32LE(20+j.length+binary.length,8);h.writeUInt32LE(j.length,12);return characterFromGLB(Uint8Array.from(Buffer.concat([h,j,binary])).buffer,{name:'红鼻子追逐者'});}
function box(actor){actor.object.updateMatrixWorld(true);return new THREE.Box3().setFromObject(actor.object,true);}
test('runtime red-nose model retains full-body bounds with original guard clip provenance and a bounded mesh budget',()=>{
 assert.ok(bytes.length<4_000_000);assert.ok(report.triangles<80000);assert.equal(doc.skins[0].joints.length,18);assert.equal(doc.animations.length,7);
 assert.deepEqual(doc.asset.extras.replaces,['guard','dog']);
 const p=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];assert.ok(p.max[1]>.49&&p.min[1]<-.49);assert.ok(p.min[2]<-.44&&p.max[2]>.44,'Tail and nose extents retained');
 for(const a of doc.animations){const source=JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/chaser_guard_${a.name}.animation.json`,import.meta.url)));assert.deepEqual(a.extras.source,source.source);assert.equal(a.extras.sourceDuration,source.duration);assert.ok(a.channels.every(c=>c.target.path!=='scale'));}
});
test('red-nose skin has valid normalized weights, grounded feet and animated legs over repeated runs',async()=>{
 const actor=await load();let vertices=0;
 actor.native.traverse(m=>{if(!m.isSkinnedMesh)return;const w=m.geometry.attributes.skinWeight,j=m.geometry.attributes.skinIndex;for(let i=0;i<w.count;i++){let sum=0;for(let k=0;k<4;k++){assert.ok(w.array[i*4+k]>=0);assert.ok(j.array[i*4+k]<18);sum+=w.array[i*4+k];}assert.ok(Math.abs(sum-1)<1e-5);vertices++;}});assert.ok(vertices>30000);
 assert.ok(Math.abs(box(actor).min.y)<.005);
 const leg=actor.native.getObjectByName('leg_B_L');let last=null,changed=0;
 for(let i=0;i<90;i++){actor.mixer.update(1/60);const b=box(actor);assert.ok(b.min.y>-.035,`Below floor: ${b.min.y}`);assert.ok(b.max.y>1.5&&b.max.y<2.5);if(last&&last.angleTo(leg.quaternion)>.001)changed++;last=leg.quaternion.clone();actor.native.traverse(n=>{if(n.isBone)assert.ok(n.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-6);});}assert.ok(changed>65);
});
test('one red-nose actor replaces both original chasers and resumes running after the source grab animation',async()=>{
 const actor=await load(),view=createChaserPresentation({guard:actor}),game=new RunnerGame();game.entities=[];game.nextSection=Infinity;game.start();game.stumble();game.advance(.1);view.update(game.state,.1);
 assert.equal(view.object.children.length,1);assert.equal(view.object.getObjectByName('Recovered_guard'),undefined);assert.equal(view.object.getObjectByName('Recovered_dog'),undefined);assert.equal(view.object.visible,true);
 game.fatalHit({type:'test'});view.update(game.state,1);const grab=actor.mixer._actions.find(a=>a.getClip().name==='catchup_1');assert.equal(grab.loop,THREE.LoopOnce);assert.ok(Number.isFinite(box(actor).max.y));
 game.revive();for(let i=0;i<30;i++)game.advance(1/120);view.update(game.state,.1);assert.equal(game.state.phase,'running');assert.ok(actor.mixer._actions.find(a=>a.getClip().name==='run').isRunning());
 game.reset();view.update(game.state,.1);assert.equal(view.object.visible,false);
});
