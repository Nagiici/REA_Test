import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { SourceCameraRig } from '../src/source-camera-rig.js';

const read = name => JSON.parse(fs.readFileSync(new URL(`../public/assets/recovered/${name}`, import.meta.url)));
const presentation = read('classic-presentation.json');
const near = (a,b,e=1e-7) => assert.ok(Math.abs(a-b)<e, `${a} != ${b}`);

test('menu camera child uses Game.SetMenuCamera local transform before parent source tracks', () => {
  const rig = new SourceCameraRig(presentation.introGraph);
  const pose = rig.sample(null, 0, 74.57140350341797);
  assert.deepEqual(pose.position, [0, 3.380000001192093, -3.3000000000000003]);
  near(pose.target[1] - pose.position[1], -Math.sin(.3752707540988922));
  near(pose.target[2] - pose.position[2], Math.cos(.3752707540988922));
  near(rig.cameraNode.position.y, 33.80000001192093);
  // The source authoring position is deliberately different and is retained in
  // the evidence object; the runtime override does not mutate that evidence.
  near(presentation.introGraph.nodes.find(n=>n.name==='Main Camera').position[1], 34.997371673583984);
});

test('source startPan parent is identity when the player intro completes', () => {
  const rig = new SourceCameraRig(presentation.introGraph);
  const pose = rig.sample(read('scene_startPan.animation.json'), 1.2083332538604736, 71);
  near(pose.position[0], 0); near(pose.position[1], 3.380000001192093); near(pose.position[2], -3.3);
  near(pose.target[0], 0);
});

test('menuIdle frames the source signed idle body offset in portrait', () => {
  const rig = new SourceCameraRig(presentation.introGraph);
  const pose = rig.sample(read('scene_menuIdle.animation.json'), 0, 74.57140350341797);
  const camera = new THREE.PerspectiveCamera(pose.fov, 9/16, .1, 100);
  camera.position.fromArray(pose.position); camera.lookAt(new THREE.Vector3().fromArray(pose.target));
  camera.updateMatrixWorld(true);
  // Unity +Z coordinates: source Root_jnt x=-7.928, z=-16.044 native.
  // The renderer reflects Z after computing this source pose, but must not
  // accidentally rotate the root translation's X sign with a fitted GLB.
  const body = new THREE.Vector3(-.7928074359893799, 1, -1.6043926239013672).project(camera);
  assert.ok(Math.abs(body.x) < 1 && Math.abs(body.y) < 1);
  const mirrored = new THREE.Vector3(.7928074359893799, 1, -1.6043926239013672).project(camera);
  assert.ok(Math.abs(mirrored.x) > 1);
});
