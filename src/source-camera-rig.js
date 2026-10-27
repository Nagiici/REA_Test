import * as THREE from 'three';

/** Legacy AnimationClip cubic Hermite sampling. Camera/property paths originate
 * in the exported Animation component; no hand-authored start-pan keyframes. */
export function sampleSourceTrack(track, time) {
  const t = Math.max(track.times[0], Math.min(track.times.at(-1), time));
  let index = 0;
  while (index < track.times.length - 2 && track.times[index + 1] < t) index++;
  const next = Math.min(index + 1, track.times.length - 1), span = track.times[next] - track.times[index];
  if (!span) return [...track.values[index]];
  const u = (t - track.times[index]) / span;
  return track.values[index].map((a, d) => {
    const b = track.values[next][d], out = track.outTangents?.[index]?.[d], incoming = track.inTangents?.[next]?.[d];
    return !Number.isFinite(out) || !Number.isFinite(incoming) ? a + (b - a) * u
      : (2*u**3-3*u*u+1)*a + (u**3-2*u*u+u)*span*out + (-2*u**3+3*u*u)*b + (u**3-u*u)*span*incoming;
  });
}

export class SourceCameraRig {
  constructor(graph, { characterPositionNative = [0, 0, 0] } = {}) {
    this.root = new THREE.Group(); this.byId = new Map(); this.byPath = new Map(); this.source = graph;
    const sources = new Map(graph.nodes.map(x => [x.id, x]));
    const pathFor = node => node.parentId ? [pathFor(sources.get(node.parentId)), node.name].filter(Boolean).join('/') : '';
    for (const source of graph.nodes) {
      const node = new THREE.Group(); node.name = source.name;
      this.byId.set(source.id, node); this.byPath.set(pathFor(source), node);
    }
    for (const source of graph.nodes) (this.byId.get(source.parentId) ?? this.root).add(this.byId.get(source.id));
    this.cameraNode = [...this.byId.values()].find(x => x.name === 'Main Camera');
    if (!this.cameraNode) throw new Error('Source camera graph has no Main Camera');
    // Game.SetMenuCamera36446 overwrites the author's static MainCamera local
    // transform before Animation samples the parent cameraRig_startGame. The
    // .375270754 rad constant was recovered from protected VA0x40268cc.
    this.menuLocalPosition = new THREE.Vector3(...characterPositionNative)
      .add(new THREE.Vector3(0, 33 + .800000011920929, -33));
    this.menuLocalRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.3752707540988922, 0, 0));
  }
  sample(clip, time, fov) {
    for (const source of this.source.nodes) {
      const node = this.byId.get(source.id);
      node.position.fromArray(source.position); node.quaternion.fromArray(source.quaternion); node.scale.fromArray(source.scale);
    }
    this.cameraNode.position.copy(this.menuLocalPosition);
    this.cameraNode.quaternion.copy(this.menuLocalRotation);
    for (const track of clip?.tracks ?? []) {
      const node = this.byPath.get(track.path);
      if (!node || !['position', 'quaternion', 'scale'].includes(track.property)) continue;
      node[track.property].fromArray(sampleSourceTrack(track, time));
      if (track.property === 'quaternion') node.quaternion.normalize();
    }
    this.root.updateMatrixWorld(true);
    const position = this.cameraNode.getWorldPosition(new THREE.Vector3()).multiplyScalar(.1);
    const q = this.cameraNode.getWorldQuaternion(new THREE.Quaternion());
    const target = position.clone().add(new THREE.Vector3(0,0,1).applyQuaternion(q));
    return { position: position.toArray(), target: target.toArray(), fov };
  }
}
