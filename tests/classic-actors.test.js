import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { chaserFromUnity } from '../src/asset-adapter.js';
import { createChaserPresentation } from '../src/chaser-presentation.js';
import { RunnerGame } from '../src/game-core.js';

const read = file => JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${file}`, import.meta.url)));
const manifest = read('manifest.json');
function loadActors() {
  return Object.fromEntries(Object.entries(manifest.chaserActors).map(([name, info]) => [name,
    chaserFromUnity(name, info, read(info.rig.file), Object.fromEntries(info.meshes.map(binding => [binding.key, read(manifest.meshes[binding.key].file)])),
      Object.fromEntries(Object.entries(info.animations).map(([key, value]) => [key, read(value.file)])))]));
}

test('original guard and dog bind in the animation-root frame without a second renderer transform', () => {
  const actors = loadActors();
  for (const actor of Object.values(actors)) {
    actor.object.updateMatrixWorld(true);
    actor.native.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      assert.equal(mesh.parent, actor.native);
      mesh.skeleton.update();
      const positions = mesh.geometry.attributes.position, weights = mesh.geometry.attributes.skinWeight;
      let error = 0;
      for (let i = 0; i < positions.count; i++) {
        const original = new THREE.Vector3().fromBufferAttribute(positions, i);
        error = Math.max(error, original.distanceTo(mesh.applyBoneTransform(i, original.clone())));
        assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-6);
      }
      assert.ok(error < 2e-5, `Rest skin error ${error}`);
    });
    for (const diagnostic of Object.values(actor.animationDiagnostics)) assert.deepEqual(diagnostic.skippedTracks, []);
  }
});

test('all original chaser clips animate finite geometry and looping run can resume after the grab', () => {
  for (const actor of Object.values(loadActors())) {
    const bone = actor.native.children[0], start = bone.quaternion.clone();
    for (const name of actor.animationNames) {
      actor.setAnimation(name);
      for (let i = 0; i < 20; i++) {
        actor.mixer.update(.05); actor.object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(actor.object, true);
        assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite));
        assert.ok(box.getSize(new THREE.Vector3()).length() < 8);
      }
    }
    actor.setAnimation('run'); actor.mixer.update(.3);
    assert.ok(actor.mixer._actions.find(a => a.loop === THREE.LoopRepeat).isRunning());
    assert.ok(start.toArray().every(Number.isFinite));
  }
});

test('chaser presentation follows native approach, freezes on pause and clears when a run resets', () => {
  const game = new RunnerGame(), actors = loadActors(), view = createChaserPresentation(actors);
  game.entities = []; game.nextSection = Infinity; game.start();
  view.update(game.state, .1); assert.equal(view.object.visible, false);
  game.stumble(); game.advance(.1); view.update(game.state, .1);
  assert.equal(view.object.visible, true);
  assert.ok(Math.abs(view.object.position.z - game.state.stumble.guardDistanceNative * .1) < 1e-8);
  const time = actors.guard.mixer.time, pos = view.object.position.clone();
  game.pause(); view.update(game.state, 2);
  assert.equal(actors.guard.mixer.time, time); assert.ok(view.object.position.equals(pos));
  game.reset(); view.update(game.state, .1); assert.equal(view.object.visible, false);
});
