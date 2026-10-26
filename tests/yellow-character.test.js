import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { characterFromGLB } from '../src/asset-adapter.js';

const bytes = fs.readFileSync(new URL('../public/assets/character/yellow-runner.glb', import.meta.url));
const length = bytes.readUInt32LE(12), document = JSON.parse(bytes.subarray(20, 20 + length));
const report = JSON.parse(fs.readFileSync(new URL('../public/assets/character/yellow-runner.json', import.meta.url)));
function withoutTextures() {
  // Node exercises the real GLTFLoader, skinning and animation controller; image
  // decoding/material appearance is covered by the browser visual check.
  const data = structuredClone(document);
  delete data.materials; delete data.textures; delete data.images; delete data.samplers;
  for (const mesh of data.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  let json = Buffer.from(JSON.stringify(data)); json = Buffer.concat([json, Buffer.alloc((4-json.length%4)%4, 32)]);
  const binary = bytes.subarray(20 + length), header = Buffer.from(bytes.subarray(0, 20));
  header.writeUInt32LE(20 + json.length + binary.length, 8); header.writeUInt32LE(json.length, 12);
  return Uint8Array.from(Buffer.concat([header, json, binary])).buffer;
}
async function load() { return characterFromGLB(withoutTextures(), { name: '黄色小怪兽', source: 'test' }); }
function bounds(character) { character.object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(character.object, true); }

test('yellow player contains 26 recovered bone mappings and the three original clip sources', () => {
  assert.equal(document.skins[0].joints.length, 26);
  assert.equal(new Set(report.bones.map(b => b.sourcePath)).size, 26);
  assert.ok(report.bytes < 7_000_000);
  assert.ok(report.meshStats.reduce((n, m) => n + m.triangles, 0) < 85_000);
  for (const animation of document.animations) {
    const source = JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${animation.name}.animation.json`, import.meta.url)));
    assert.deepEqual(animation.extras.source, source.source);
    assert.equal(animation.extras.sourceDuration, source.duration);
  }
  assert.deepEqual(document.animations.map(a => a.name).sort(), ['jump', 'roll', 'run']);
});

test('yellow GLB loads as a skinned, grounded player with normalized four-joint weights', async () => {
  const character = await load();
  let vertices = 0, meshes = 0;
  character.native.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return; meshes++;
    const weights = mesh.geometry.attributes.skinWeight, joints = mesh.geometry.attributes.skinIndex;
    for (let i = 0; i < weights.count; i++) {
      let total = 0;
      for (let j = 0; j < 4; j++) { total += weights.array[i*4+j]; assert.ok(joints.array[i*4+j] < 26); }
      assert.ok(Math.abs(total-1) < 1e-5); vertices++;
    }
  });
  assert.equal(meshes, 2); assert.ok(vertices > 30000);
  const box = bounds(character);
  assert.ok(Math.abs(box.min.y) < .005); assert.ok(Math.abs(box.max.y - 1.95) < .005);
});

test('recovered run motion moves the yellow legs and keeps the skinned mesh above ground', async () => {
  const character = await load(), leg = character.native.getObjectByName('L_Knee_jnt');
  character.mixer.update(.02); bounds(character); const first = leg.getWorldPosition(new THREE.Vector3());
  let minimum = Infinity;
  for (let i=0;i<24;i++) { character.mixer.update(.4166667/24); const box=bounds(character); minimum=Math.min(minimum,box.min.y); assert.ok(Number.isFinite(box.max.y)); assert.ok(box.max.y < 2.4); }
  character.mixer.update(.15); bounds(character);
  assert.ok(first.distanceTo(leg.getWorldPosition(new THREE.Vector3())) > .03);
  assert.ok(minimum > -.04, `Lowest run surface: ${minimum}`);
});

test('jump and roll use one-shot durations, roll tucks, and run can resume', async () => {
  const character = await load();
  character.setAnimation('jump', 1.26); character.mixer.update(.4);
  const jump = character.mixer._actions.find(a=>a.getClip().name==='jump');
  assert.equal(jump.loop, THREE.LoopOnce); assert.ok(jump.isRunning());
  character.setAnimation('roll', .7); character.mixer.update(.35);
  const rollBox=bounds(character);
  assert.ok(rollBox.max.y-rollBox.min.y < .85, `Roll height: ${rollBox.max.y-rollBox.min.y}`);
  assert.ok(rollBox.min.y > -.04);
  character.mixer.update(.5);
  assert.ok(character.mixer._actions.find(a=>a.getClip().name==='roll').paused);
  character.setAnimation('run'); character.mixer.update(.2);
  assert.ok(character.mixer._actions.find(a=>a.getClip().name==='run').isRunning());
  assert.ok(bounds(character).max.y > 1.4);
});
