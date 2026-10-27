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

test('yellow player contains 26 recovered bone mappings and the original locomotion and equipment clip sources', () => {
  assert.equal(document.skins[0].joints.length, 26);
  assert.equal(new Set(report.bones.map(b => b.sourcePath)).size, 26);
  assert.ok(report.bytes < 10_000_000);
  assert.ok(report.meshStats.reduce((n, m) => n + m.triangles, 0) < 85_000);
  for (const animation of document.animations) {
    const source = JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${animation.name}.animation.json`, import.meta.url)));
    assert.deepEqual(animation.extras.source, source.source);
    assert.equal(animation.extras.sourceDuration, source.duration);
  }
  const pools = JSON.parse(fs.readFileSync(new URL('../public/assets/recovered/classic-motion-pools.json', import.meta.url)));
  assert.equal(document.animations.length, 44);
  for (const name of [...Object.values(pools).flat(), 'intro_run', 'idle_paint', 'caught_left_neck', 'caught_right_leg', 'board_left', 'flight_right']) assert.ok(document.animations.some(a => a.name === name), name);
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
    character.setAnimation(rolling?'roll':'run', game.config.rollSeconds, rolling ? game.state.player.rollToken : null);
    character.mixer.update(1/60);
    const q=character.native.getObjectByName('Root_jnt').quaternion.clone();
    if (i>60 && i<180 && rolling) {
      assert.ok(character.mixer._actions.find(a=>a.getClip().name==='roll').isRunning(), `Roll froze at frame ${i}`);
      if(previousQuaternion && q.angleTo(previousQuaternion)>.001) changes++;
    }
    previousQuaternion=q;
  }
  assert.ok(changes>80, `Only ${changes} moving frames during sustained rolling`);
  assert.equal(game.state.player.rollRemaining,0);
  assert.ok(character.mixer._actions.find(a=>a.getClip().name==='run').isRunning());
});

test('equipment motions loop independently and the source board attachment follows its own tracks', async () => {
  const character = await load(), attachment = character.native.getObjectByName('SourceBoardAttachment');
  assert.ok(attachment);
  for (const name of ['flight','board_run','board_roll']) {
    character.setAnimation(name, name==='board_roll' ? .7 : undefined);
    character.mixer.update(.2); const first = attachment.position.clone();
    character.mixer.update(.23);
    const action=character.mixer._actions.find(a=>a.getClip().name===name);
    assert.equal(action.loop,THREE.LoopRepeat); assert.ok(action.isRunning());
    assert.ok(Number.isFinite(bounds(character).max.y));
    if (name==='board_run') assert.ok(first.distanceTo(attachment.position)>.001);
    character.native.traverse(b=>{if(b.isBone)assert.ok(b.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-6);});
  }
});

test('classic reactions keep constant bone scale, replay on a new contact and return to locomotion', async () => {
  const character = await load();
  let token = 1;
  for (const name of ['stumble_left', 'stumble_right', 'stumble_low', 'stumble_mix', 'death_bounce', 'death_upper', 'death_lower', 'death_moving_train', 'caught_fall']) {
    character.setAnimation(name, undefined, token++);
    for (let frame = 0; frame < 24; frame++) {
      character.mixer.update(1 / 30);
      character.native.traverse(bone => { if (bone.isBone) assert.ok(bone.scale.distanceTo(new THREE.Vector3(1,1,1)) < 1e-6); });
    }
    assert.ok(Number.isFinite(bounds(character).max.y));
    const action = character.mixer._actions.find(a => a.getClip().name === name);
    assert.equal(action.loop, THREE.LoopOnce);
    character.setAnimation(name, undefined, token++); character.mixer.update(.01);
    assert.ok(action.time < .02, `${name} did not restart after a new contact`);
    assert.ok(action.isRunning());
  }
  character.setAnimation('run'); character.mixer.update(.3);
  assert.ok(character.mixer._actions.find(a => a.getClip().name === 'run').isRunning());
  assert.ok(bounds(character).max.y > 1.4);
});
