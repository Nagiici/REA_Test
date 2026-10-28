/** Bounded browser Object3D reuse; asset geometry/materials remain pack-owned.
 * No gameplay entity, motion, or coin producer is stored on a pooled visual. */
export class EntityVisualPool {
  constructor(create, { maxTotal = 96, maxPerKey = 12 } = {}) {
    this.create = create; this.maxTotal = maxTotal; this.maxPerKey = maxPerKey;
    this.free = new Map(); this.records = new WeakMap();
    this.stats = { created: 0, reused: 0, retained: 0, discarded: 0 };
  }
  key(entity) {
    return JSON.stringify(entity.visual ?? { type: entity.type, width: entity.width, height: entity.height, depth: entity.depth });
  }
  acquire(entity) {
    if (entity.visual === null) return null; // collision-only entities need no scene node
    const key = this.key(entity), list = this.free.get(key);
    let object = list?.pop();
    if (object) {
      this.stats.retained--; this.stats.reused++;
      if (!list.length) this.free.delete(key);
      const record = this.records.get(object); record.free = false;
      for (const [node, state] of record.nodes) {
        node.position.copy(state.position); node.quaternion.copy(state.quaternion); node.scale.copy(state.scale);
        node.visible = state.visible; node.matrixAutoUpdate = state.matrixAutoUpdate;
        node.matrix.copy(state.matrix); node.matrixWorldNeedsUpdate = true;
      }
    } else {
      object = this.create(entity); this.stats.created++;
      const nodes = [];
      object.traverse(node => nodes.push([node, { position: node.position.clone(), quaternion: node.quaternion.clone(),
        scale: node.scale.clone(), visible: node.visible, matrixAutoUpdate: node.matrixAutoUpdate, matrix: node.matrix.clone() }]));
      this.records.set(object, { key, nodes, free: false });
    }
    return object;
  }
  release(object) {
    const record = this.records.get(object);
    if (!record || record.free) return;
    object.removeFromParent(); object.visible = false; record.free = true;
    const list = this.free.get(record.key) ?? [];
    if (this.stats.retained >= this.maxTotal || list.length >= this.maxPerKey) {
      this.records.delete(object); this.stats.discarded++; return;
    }
    list.push(object); this.free.set(record.key, list); this.stats.retained++;
  }
}
