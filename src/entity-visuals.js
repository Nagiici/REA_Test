import * as THREE from 'three';

// Collision volumes and rendered prefab instances are separate in the original
// route graph. A train group can contain several cars but one large collider.
// Matrices supplied by the route compiler are row-major, in browser units, and
// relative to the entity anchor (x, 0, -distance). Asset clones already include
// the Unity-to-browser basis conversion.
export function createEntityVisual(entity, pack) {
  if (entity.visual === null) return new THREE.Group();
  if (entity.visual) {
    const descriptor = entity.visual;
    const model = descriptor.prefabKey ? pack.clonePrefab(descriptor.prefabKey)
      : pack.cloneProp(descriptor.meshKey);
    if (!model) throw new Error(`缺少关卡模型：${descriptor.prefabKey ?? descriptor.meshKey}`);
    const holder = new THREE.Group();
    holder.name = entity.provenance?.nodeName ?? descriptor.prefabKey ?? descriptor.meshKey;
    if (descriptor.matrix) {
      if (descriptor.matrix.length !== 16 || !descriptor.matrix.every(Number.isFinite)) {
        throw new Error(`关卡模型变换无效：${holder.name}`);
      }
      model.applyMatrix4(new THREE.Matrix4().set(...descriptor.matrix));
    }
    holder.add(model);
    return holder;
  }
  if (entity.type === 'coin') {
    const coin = pack.cloneProp('currency_coin');
    if (!coin) throw new Error('缺少金币模型');
    return coin;
  }
  // Compatibility for the small unit-test/demo course. Original route instances
  // always provide an explicit visual descriptor or visual:null.
  const key = { train: 'default_train_standard', barrier: 'blocker_jump',
    overhead: 'blocker_roll', ramp: 'MexicoCity_train_ramp', full: 'blocker_full' }[entity.type];
  if (!key) return new THREE.Group();
  const model = pack.cloneProp(key);
  if (!model) throw new Error(`缺少关卡模型：${key}`);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  const scale = new THREE.Vector3(entity.width / size.x, entity.height / size.y, entity.depth / size.z);
  model.scale.multiply(scale);
  model.position.set(-(bounds.min.x + bounds.max.x) / 2 * scale.x,
    -bounds.min.y * scale.y, -(bounds.min.z + bounds.max.z) / 2 * scale.z);
  const holder = new THREE.Group(); holder.add(model); return holder;
}
