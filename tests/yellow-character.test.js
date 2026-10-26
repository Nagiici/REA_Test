import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { characterFromGLB } from '../src/asset-adapter.js';
import { RunnerGame } from '../src/game-core.js';

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

test('jump remains a one-shot while roll keeps its size and can return to run', async () => {
  const character = await load();
  character.setAnimation('jump', 1.26); character.mixer.update(.4);
  const jump = character.mixer._actions.find(a=>a.getClip().name==='jump');
  assert.equal(jump.loop, THREE.LoopOnce); assert.ok(jump.isRunning());
  character.setAnimation('roll', .7); character.mixer.update(.35);
  const rollBox=bounds(character);
  assert.ok(character.native.getObjectByName('Root_jnt').scale.distanceTo(new THREE.Vector3(1,1,1)) < 1e-6);
  assert.ok(rollBox.min.y > -.04);
  character.mixer.update(.5);
  assert.ok(character.mixer._actions.find(a=>a.getClip().name==='roll').isRunning());
  character.setAnimation('run'); character.mixer.update(.2);
  assert.ok(character.mixer._actions.find(a=>a.getClip().name==='run').isRunning());
  assert.ok(bounds(character).max.y > 1.4);
});

test('roll never scales the skeleton and consecutive cycles meet at the same pose', async () => {
  const character = await load(); character.setAnimation('roll', .7);
  const action = character.mixer._actions.find(a => a.getClip().name === 'roll');
  const root = character.native.getObjectByName('Root_jnt');
  character.mixer.update(.1);
  for (let i=0;i<42;i++) {
    character.mixer.update(1/60);
    character.native.traverse(bone => { if (bone.isBone) assert.ok(bone.scale.distanceTo(new THREE.Vector3(1,1,1)) < 1e-6, `${bone.name} changed size`); });
  }
  assert.equal(action.loop, THREE.LoopRepeat);
  const clip = document.animations.find(a => a.name === 'roll');
  const binary = bytes.subarray(28 + length);
  for (const channel of clip.channels) {
    const accessor = document.accessors[clip.samplers[channel.sampler].output], view = document.bufferViews[accessor.bufferView];
    const values = new Float32Array(Uint8Array.from(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)).buffer);
    const width = channel.target.path === 'rotation' ? 4 : 3;
    if (width === 4) {
      const first = new THREE.Quaternion().fromArray(values).normalize(), last = new THREE.Quaternion().fromArray(values, values.length-4).normalize();
      assert.ok(first.angleTo(last)<1e-5, `Rotation loop seam: ${document.nodes[channel.target.node].name}`);
    } else for (let j=0;j<width;j++) assert.ok(Math.abs(values[j]-values[values.length-width+j]) < 1e-5, `Loop seam: ${document.nodes[channel.target.node].name}`);
  }
  assert.ok(Number.isFinite(root.position.y));
});

test('rapid roll inputs keep animating beyond the first clip and recover after inputs stop', async () => {
  const character = await load(), game = new RunnerGame();
  game.entities=[]; game.nextSection=1e9; game.start();
  let previousQuaternion = null, changes = 0;
  for (let i=0;i<240;i++) {
    if (i < 180 && i%12===0) game.action('roll');
    game.advance(1/60);
    const rolling=game.state.player.rollRemaining>0;
    character.setAnimation(rolling?'roll':'run', game.config.rollSeconds);
    character.mixer.update(1/60);
    const q=character.native.getObjectByName('Root_jnt').quaternion.clone();
    if (i>60 && i<180) {
      assert.ok(character.mixer._actions.find(a=>a.getClip().name==='roll').isRunning(), `Roll froze at frame ${i}`);
      if(previousQuaternion && q.angleTo(previousQuaternion)>.001) changes++;
    }
    previousQuaternion=q;
  }
  assert.ok(changes>100, `Only ${changes} moving frames during sustained rolling`);
  assert.equal(game.state.player.rollRemaining,0);
  assert.ok(character.mixer._actions.find(a=>a.getClip().name==='run').isRunning());
});
