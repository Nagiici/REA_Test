import { Matrix4, Quaternion, Vector3 } from 'three';
import { SourceSpawnPointManager } from './source-spawn-points.js';

const IDENTITY = new Matrix4();
const vector = value => new Vector3().fromArray(value);

/** Browser replay RNG. The original Unity Random state is not exported. */
export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffleSourceList(items, random) {
  for (let count = items.length; count > 1; count--) {
    const index = Math.floor(random() * count);
    [items[index], items[count - 1]] = [items[count - 1], items[index]];
  }
  return items;
}

export function sourceWeightedPicker({ entries, evaluator, scope, random, state, decisions = [] }) {
  const identity = item => item.Prefab?.ref ?? item.prefabPath?.toLowerCase();
  let list = state.get(scope);
  if (!list) {
    const weighted = [];
    for (const entry of entries) {
      if (!identity(entry) || entry.Weight <= 0) continue;
      if (!Number.isInteger(entry.Weight)) throw new Error(`Non-integer source weight in ${scope}`);
      for (let i = 0; i < entry.Weight; i++) weighted.push(entry);
    }
    list = new SemiRandomlyOrderedList(weighted, random, identity);
    state.set(scope, list);
  }
  let selected = list.getNextMatching(random, evaluator), usedFallback = false;
  if (!selected) {
    shuffleSourceList(list.used, random);
    selected = list.used.find(evaluator) ?? null;
    usedFallback = selected != null;
  }
  decisions.push({ type: 'WeightedPick', scope, selected: selected && identity(selected), usedFallback, readyCount: list.ready.length, usedCount: list.used.length });
  return selected;
}

/** Native SemiRandomlyOrderedList ready/used regeneration, retaining duplicates. */
export class SemiRandomlyOrderedList {
  constructor(items, random, identity = item => item) {
    this.ready = [...items]; this.used = []; this.all = [...items]; this.identity = identity;
    this.reset(random);
  }
  reset(random) { this.regenerate(random); shuffleSourceList(this.ready, random); }
  get isEmpty() { return this.ready.length === 0 && this.used.length === 0; }
  regenerate(random) {
    if (!this.used.length) return;
    shuffleSourceList(this.used, random);
    this.ready.push(...this.used); this.used.length = 0;
  }
  consume(item, random) {
    const index = this.ready.findIndex(candidate => this.identity(candidate) === this.identity(item));
    if (index < 0) throw new Error('Consumed source-list item is not ready');
    this.ready.splice(index, 1); this.used.push(item);
    if (this.ready.length <= 3 && this.used.length >= 4 || this.ready.length <= 2 && this.used.length >= 3 || this.ready.length <= 1) this.regenerate(random);
  }
  getNext(random) {
    if (!this.ready.length) return null;
    const item = this.ready[0]; this.consume(item, random); return item;
  }
  getNextMatching(random, evaluator) {
    const evaluated = new Set();
    for (const item of this.ready) {
      const identity = this.identity(item);
      if (evaluated.has(identity)) continue;
      if (evaluator(item)) { this.consume(item, random); return item; }
      evaluated.add(identity);
    }
    return null;
  }
}

export function rowMajor(matrix) {
  const e = matrix.elements;
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], e[3], e[7], e[11], e[15]];
}

export function unityLocalMatrix(node) {
  return new Matrix4().compose(vector(node.position ?? [0, 0, 0]), new Quaternion().fromArray(node.quaternion ?? [0, 0, 0, 1]), vector(node.scale ?? [1, 1, 1]));
}

export function browserMatrix(nativeMatrix, unitScale = 0.1) {
  const conversion = new Matrix4().makeScale(unitScale, unitScale, -unitScale);
  return conversion.clone().multiply(nativeMatrix).multiply(conversion.clone().invert());
}

/** Relative visual transform for a resource already converted by C. */
export function visualMatrix(nativeMatrix, anchor, unitScale = 0.1) {
  const matrix = browserMatrix(nativeMatrix, unitScale);
  matrix.elements[12] -= anchor.x;
  matrix.elements[13] -= anchor.y ?? 0;
  matrix.elements[14] += anchor.distance;
  return rowMajor(matrix);
}

/** Preserve rotation/negative scale when deriving an axis-aligned collision box. */
export function colliderBounds(collider, nativeMatrix, unitScale = 0.1) {
  const size = collider.m_Size ?? collider.size;
  const center = collider.m_Center ?? collider.center ?? { x: 0, y: 0, z: 0 };
  if (!size) throw new Error('A box collider requires its original serialized size');
  const c = Array.isArray(center) ? center : [center.x, center.y, center.z];
  const s = Array.isArray(size) ? size : [size.x, size.y, size.z];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const p = vector([c[0] + x * s[0] / 2, c[1] + y * s[1] / 2, c[2] + z * s[2] / 2]).applyMatrix4(nativeMatrix).multiplyScalar(unitScale);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p.getComponent(i)); max[i] = Math.max(max[i], p.getComponent(i)); }
  }
  return { x: (min[0] + max[0]) / 2, distance: (min[2] + max[2]) / 2, width: max[0] - min[0], depth: max[2] - min[2], bottom: min[1], height: max[1] };
}

/** Inverse native-space slabs for an exact vertical query through a rotated box. */
export function colliderShape(collider, nativeMatrix, anchor, unitScale = 0.1) {
  const inverse = nativeMatrix.clone().invert().elements;
  const center = collider.m_Center ?? { x: 0, y: 0, z: 0 };
  const c = Array.isArray(center) ? center : [center.x, center.y, center.z];
  const rows = [0, 1, 2].map(index => [inverse[index] / unitScale, inverse[index + 4] / unitScale, inverse[index + 8] / unitScale,
    inverse[index] * anchor.x / unitScale + inverse[index + 8] * anchor.distance / unitScale + inverse[index + 12] - c[index]]);
  if (collider.m_Size) {
    const s = collider.m_Size;
    return { type: 'box', rows, halfSize: [s.x / 2, s.y / 2, s.z / 2] };
  }
  if (Number.isFinite(collider.m_Radius) && Number.isFinite(collider.m_Height)) return { type: 'capsule', rows, radius: collider.m_Radius, halfSegment: Math.max(0, collider.m_Height / 2 - collider.m_Radius), axis: collider.m_Direction ?? 1 };
  throw new Error('Unsupported source collider shape');
}

export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map(node => [String(node.id), node]));
  const children = new Map(graph.nodes.map(node => [String(node.id), []]));
  const roots = [];
  for (const node of graph.nodes) {
    const parent = node.parentId == null ? null : String(node.parentId);
    if (parent == null || !nodes.has(parent)) roots.push(String(node.id));
    else children.get(parent).push(String(node.id));
  }
  for (const node of graph.nodes) if (node.childIds) {
    const actual = children.get(String(node.id));
    const ordered = node.childIds.map(String).filter(id => nodes.has(id));
    // Exported child order is significant for Unity Random.Range indexing.
    for (const id of actual) if (!ordered.includes(id)) throw new Error(`Incomplete childIds on ${graph.resourceName ?? graph.source?.name}:${node.id}`);
    children.set(String(node.id), ordered);
  }
  const scripts = new Map();
  for (const node of graph.nodes) for (const script of node.scripts ?? []) {
    if (script.source?.pathId != null) scripts.set(String(script.source.pathId), { node, script });
  }
  return { graph, nodes, children, roots, scripts };
}

/**
 * Hierarchy traversal shared by the recovered policies. Selection decisions are
 * explicit; excluded branches are never flattened into the playable scene.
 * The caller must specify how an instantiated prefab's root TRS is applied.
 */
export function walkGraph(graph, { parentMatrix = IDENTITY, rootTransform = 'preserve', resolveNode = () => ({}), visit, lineage = [] } = {}) {
  const indexed = indexGraph(graph);
  const visiting = new Set();
  function walk(id, parent, isRoot, path) {
    if (visiting.has(id)) throw new Error(`Transform cycle at ${id}`);
    const node = indexed.nodes.get(id);
    visiting.add(id);
    let local = isRoot && rootTransform === 'identity' ? new Matrix4()
      : isRoot && rootTransform === 'spawned' ? new Matrix4().makeScale(...(node.scale ?? [1, 1, 1])) : unityLocalMatrix(node);
    const decision = resolveNode({ node, graph, indexed, local, path }) ?? {};
    if (decision.active === false || node.active === false && decision.active !== true) { visiting.delete(id); return; }
    if (decision.localMatrix) local = decision.localMatrix;
    const matrix = parent.clone().multiply(local);
    const nextPath = [...path, id];
    visit?.({ node, graph, indexed, matrix, path: nextPath, decision });
    const children = decision.childIds ?? indexed.children.get(id);
    for (const child of children) {
      if (!indexed.children.get(id).includes(String(child))) throw new Error(`Selected node ${child} is not a child of ${id}`);
      walk(String(child), matrix, false, nextPath);
    }
    visiting.delete(id);
  }
  for (const id of indexed.roots) walk(id, parentMatrix, true, lineage);
}

/** Source AnimationCurve scalar evaluation inside its serialized time range. */
export function evaluateUnityCurve(curve, time) {
  const keys = curve?.keys ?? [];
  if (!keys.length) return 0;
  if (time <= keys[0].time) return keys[0].value;
  if (time >= keys.at(-1).time) return keys.at(-1).value;
  let right = 1;
  while (keys[right].time < time) right++;
  const a = keys[right - 1], b = keys[right];
  if (a.weightedMode || b.weightedMode) throw new Error('Weighted source animation curves require their recovered weighting rule');
  const span = b.time - a.time, t = (time - a.time) / span;
  if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a.value
    + (t ** 3 - 2 * t ** 2 + t) * span * a.outSlope
    + (-2 * t ** 3 + 3 * t ** 2) * b.value
    + (t ** 3 - t ** 2) * span * b.inSlope;
}

export function sampleSourceCurve(curve, time) {
  return ['X', 'Y', 'Z'].map(axis => evaluateUnityCurve(curve[`curve${axis}`], time));
}

export function initializeCoinCurve(curve) {
  // CoinCurve.Awake 82770 -> ForceLinearZ(true) -> RecacheCurve/LinearizeZ
  // 15484/15486/15487. X/Y retain their original Hermite curves.
  const z0 = evaluateUnityCurve(curve.curveZ, curve._minTime ?? 0);
  const z1 = evaluateUnityCurve(curve.curveZ, curve._maxTime ?? 1);
  return { ...curve, curveZ: { ...curve.curveZ, keys: [
    { time: 0, value: z0, inSlope: 0, outSlope: z1 - z0 },
    { time: 1, value: z1, inSlope: z1 - z0, outSlope: 0 },
  ] } };
}

function coinSpacingAtSpeed(fields, nativeSpeed) {
  return (fields._spacingMode === 1 ? 30 : 15) * (fields._scaleMode === 2 ? nativeSpeed / 110 : 1);
}

function curvePointForCoin(rule, index, nativeSpeed, speedChanged) {
  const { fields, curve, matrix, own, count } = rule;
  if (!curve) return [...own];
  const speedScale = fields._scaleMode === 0 ? 1 : nativeSpeed / 110;
  const length = (sampleSourceCurve(curve, 1)[2] - sampleSourceCurve(curve, 0)[2]) * speedScale;
  const currentTheoreticalCount = Math.floor(Math.abs(length) / coinSpacingAtSpeed(fields, nativeSpeed)) + 1;
  // Native GetCoinPosition 82776 tests the current count ignoring skip here,
  // independently of the stored count used in the redistribution denominator.
  if (currentTheoreticalCount <= 1) return [...own];
  // Browser finite-value guard: native has no additional protection when one
  // spawned coin later enters a speed mode whose theoretical count exceeds one.
  // Keeping that existing coin at its anchor avoids native division by zero.
  if (speedChanged && count <= 1) return [...own];
  const t = speedChanged ? index / (count - 1) : index * coinSpacingAtSpeed(fields, nativeSpeed) / length;
  const worldZ = rule.start[2] + (rule.end[2] - rule.start[2]) * t;
  const localZ = worldZ - matrix[11];
  const minZ = curve._minCoords[2], maxZ = curve._maxCoords[2];
  const lookup = localZ <= minZ ? 0 : localZ >= maxZ ? 1 : (localZ - minZ) / (maxZ - minZ);
  const local = sampleSourceCurve(curve, lookup);
  const point = [0, 1, 2].map(row => matrix[row * 4] * local[0] + matrix[row * 4 + 1] * local[1] + matrix[row * 4 + 2] * local[2] + matrix[row * 4 + 3]);
  point[2] = rule.start[2] + (rule.end[2] - rule.start[2]) * (t - fields._curveOffset) * speedScale;
  return point;
}

/** Exact ordinary Randomizer selection and Mirror position-only activation. */
export function createSelectionResolver({ random, scope, mirrorState = new Map(), decisions = [] }) {
  const active = new Set(), positionX = new Map();
  return ({ node, indexed }) => {
    const result = {};
    if (active.has(String(node.id))) result.active = true;
    if (positionX.has(String(node.id))) result.localMatrix = unityLocalMatrix({ ...node, position: [positionX.get(String(node.id)), node.position?.[1] ?? 0, node.position?.[2] ?? 0] });
    // A disabled unselected branch cannot consume RNG or alter a mirror.
    if (node.active === false && result.active !== true) return result;
    const randomizer = node.scripts?.find(script => script.class === 'Randomizer');
    const mirror = node.scripts?.find(script => script.class === 'Mirror');
    const children = indexed.children.get(String(node.id));
    if (randomizer) {
      const probability = randomizer.decodedFields?._activationProbability;
      if (!Number.isFinite(probability)) throw new Error(`Missing verified Randomizer activation probability: ${scope}/${node.id}`);
      const activationDraw = random(), indexDraw = random();
      const selectedIndex = Math.floor(indexDraw * children.length);
      const selected = activationDraw < probability && children.length ? children[selectedIndex] : null;
      result.childIds = selected == null ? [] : [selected];
      if (selected != null) active.add(selected);
      decisions.push({ type: 'Randomizer', scope, nodeId: node.id, activationDraw, indexDraw, probability, selectedIndex, selected, source: randomizer.source });
    }
    if (mirror) {
      const draw = random(), sign = Math.floor(draw * 2) * 2 - 1;
      for (const child of children) {
        const stateKey = `${scope}/${node.id}/${child}`;
        const x = (mirrorState.get(stateKey) ?? indexed.nodes.get(child).position?.[0] ?? 0) * sign;
        mirrorState.set(stateKey, x); positionX.set(child, x);
      }
      decisions.push({ type: 'Mirror', scope, nodeId: node.id, draw, sign, source: mirror.source });
    }
    return result;
  };
}

/** Base RouteBuilder section gates; all distances here remain native units. */
export function sectionEligibility(fields, state, { z, sectionCountUsed, minimumRepeatDistance = 0, lastSection = null, excludedPreviousSections = [] }) {
  const reasons = [];
  const repeat = fields._repeatConfiguration ?? {};
  if ((state.sectionsRemaining ?? 0) > 0) reasons.push('sections-between-repeats');
  if (state.lastSpawnZ && z < state.lastSpawnZ + Math.max(repeat._distanceBetweenRepeats ?? 0, minimumRepeatDistance)) reasons.push('distance-between-repeats');
  if (lastSection != null && excludedPreviousSections.includes(lastSection)) reasons.push('do-not-spawn-after');
  if (z < (fields._zMinimum ?? 0)) reasons.push('z-minimum');
  if (fields._zMaximumActive && z > fields._zMaximum) reasons.push('z-maximum');
  if (fields._minSpawnOrder && sectionCountUsed < fields._minSpawnOrder + 1) reasons.push('minimum-spawn-order');
  return { allowed: reasons.length === 0, reasons };
}

export function recordSectionSpawn(states, selectedId, fields, leadingZ, lengthMax) {
  for (const state of states.values()) state.sectionsRemaining = Math.max(0, (state.sectionsRemaining ?? 0) - 1);
  const selected = states.get(selectedId) ?? {};
  selected.lastSpawnZ = leadingZ + lengthMax;
  selected.sectionsRemaining = fields._repeatConfiguration?._sectionsBetweenRepeats ?? 0;
  states.set(selectedId, selected);
}

function capsuleBounds(fields, matrix, unitScale) {
  const center = fields.m_Center ?? { x: 0, y: 0, z: 0 };
  const p = vector([center.x, center.y, center.z]).applyMatrix4(matrix).multiplyScalar(unitScale);
  const axis = fields.m_Direction ?? 1, radius = fields.m_Radius;
  const halfSegment = Math.max(0, fields.m_Height / 2 - radius), m = matrix.elements;
  const extents = [0, 1, 2].map(i => unitScale * (radius * Math.hypot(m[i], m[i + 4], m[i + 8]) + halfSegment * Math.abs(m[i + axis * 4])));
  return { x: p.x, distance: p.z, width: extents[0] * 2, depth: extents[2] * 2, bottom: p.y - extents[1], height: p.y + extents[1] };
}

/** Reconstructs source graphs. Scheduling is driven by serialized RouteSection settings. */
export class SourceRouteGenerator {
  constructor(library, { seed = 48709, unitScale = 0.1, picker = sourceWeightedPicker, enabledPowerups = ['magnet', 'sneakers', 'doubleScore', 'jetpack'], spawnPointOptions = {} } = {}) {
    this.library = library;
    this.unitScale = unitScale;
    this.initialDistance = 0;
    this.routes = library.routes ?? {};
    this.definitions = library.definitions ?? {};
    this.settings = library.settings;
    this.picker = picker;
    this.enabledPowerups = new Set(enabledPowerups);
    this.spawnPointManager = new SourceSpawnPointManager(spawnPointOptions);
    this.chunkIds = Object.keys(this.routes);
    this.reset(seed);
  }

  reset(seed = this.seed) {
    this.seed = seed;
    this.random = seededRandom(seed);
    this.mirrorState = new Map();
    this.sectionStates = new Map();
    this.chunkQueue = [];
    this.sectionCount = 0;
    this.lastSection = null;
    this.compilationCount = 0;
    this.currentSection = null;
    this.pickerState = new Map();
    this.pendingJetpackLanding = null;
    this.landingSafetyPadding = null;
    this.spawnPointManager.reset();
  }

  resolveChunk(chunkId) {
    const key = String(chunkId).toLowerCase();
    const reference = this.library.routeRefs?.[chunkId];
    const found = this.routes[reference] ?? this.routes[chunkId] ?? this.routes[key] ?? Object.values(this.routes).find(route => route.resourceName?.toLowerCase() === key || route.source?.name?.toLowerCase() === key);
    if (!found) throw new Error(`Recovered route chunk is missing: ${chunkId}`);
    return found;
  }

  compileChunk(chunkId, context = {}) {
    const chunk = this.resolveChunk(chunkId);
    const startDistance = context.startDistance ?? 0;
    const nativeLength = chunk.verifiedChunkLength ?? chunk.length;
    if (!Number.isFinite(nativeLength) || nativeLength <= 0) throw new Error(`Chunk has no verified source length: ${chunkId}`);
    const result = {
      length: nativeLength * this.unitScale, entities: [], decisions: [],
      provenance: { chunkId, source: chunk.source, seed: this.seed, unitScale: this.unitScale, compilation: this.compilationCount++ },
      environmentHints: { chunkFields: chunk.routeChunkFields, sectionId: context.sectionId, sectionFields: context.sectionFields },
      diagnostics: [], environmentRegions: [],
    };
    const matrix = new Matrix4().makeTranslation(0, 0, startDistance / this.unitScale);
    const instance = this.createInstance(chunk, String(chunkId), false, result);
    instance.parentMatrix = matrix;
    const selectors = chunk.routeChunkFields?._selectors?.map(ref => ref.ref) ?? instance.selectors.map(item => item.script.id);
    this.performSelections(instance, selectors, result);
    this.activateTrackObjects(instance, result);
    this.emitInstance(instance, matrix, { ...context, startDistance, speed: context.speed ?? 11 }, result);
    return result;
  }

  createInstance(graph, scope, prefab, result, depth = 0) {
    if (depth > 30) throw new Error(`Recursive source prefab cycle: ${scope}`);
    const indexed = indexGraph(graph);
    const instance = { graph, scope, prefab, depth, indexed, parentMatrix: IDENTITY, active: new Map(), positions: new Map(), spawned: new Map(), powerups: new Map(), initialized: new Set(), visited: new Set(), selectors: [], result };
    for (const node of graph.nodes) instance.active.set(String(node.id), node.active !== false || prefab && indexed.roots.includes(String(node.id)));
    const collect = id => {
      const node = indexed.nodes.get(id);
      for (const script of node.scripts ?? []) if (['Selector', 'Randomizer', 'SpawnPoint'].includes(script.class)) instance.selectors.push({ node, script });
      for (const child of indexed.children.get(id)) collect(child);
    };
    for (const root of indexed.roots) collect(root);
    if (graph.initializationDerived?.selectorRefs) {
      const order = graph.initializationDerived.selectorRefs;
      instance.selectors.sort((a, b) => order.indexOf(a.script.id) - order.indexOf(b.script.id));
    }
    // Timing 0=Awake, 1=Start. Both occur before route content is played;
    // these source components only toggle their own GameObject and consume no RNG.
    for (const timing of [0, 1]) for (const node of graph.nodes) for (const script of node.scripts ?? []) {
      if (script.class === 'SetActiveComponent' && script.decodedFields._toggleActiveTiming === timing) {
        instance.active.set(String(node.id), script.decodedFields._toggleActiveValue);
        result.decisions.push({ type: 'SetActiveComponent', scope, nodeId: node.id, timing, active: script.decodedFields._toggleActiveValue, source: script.source });
      }
    }
    // PlaceholderPrefab.Initialize caches all selectors, including inactive ones,
    // from the prefab hierarchy before the pool clones it.
    for (const node of graph.nodes) if (this.isNodeActive(instance, String(node.id))) this.onEnable(instance, node, result);
    return instance;
  }

  isNodeActive(instance, id) {
    let node = instance.indexed.nodes.get(String(id));
    while (node) {
      if (!instance.active.get(String(node.id))) return false;
      node = instance.indexed.nodes.get(String(node.parentId));
    }
    return true;
  }

  setNodeActive(instance, id, value, result) {
    const previouslyActive = new Set(instance.graph.nodes.filter(node => this.isNodeActive(instance, String(node.id))).map(node => String(node.id)));
    instance.active.set(String(id), value);
    if (value) for (const node of instance.graph.nodes) if (!previouslyActive.has(String(node.id)) && this.isNodeActive(instance, String(node.id))) this.onEnable(instance, node, result);
  }

  onEnable(instance, node, result) {
    const script = node.scripts?.find(item => item.class === 'RandomizeOffset');
    if (!script) return;
    const flags = script.decodedFields.randomOffsets;
    const offsets = [[flags.left, -20], [flags.mid, 0], [flags.right, 20]].filter(([enabled]) => enabled).map(([, x]) => x);
    if (!offsets.length) return;
    const draw = this.random(), selected = offsets[Math.floor(draw * offsets.length)];
    const position = [...(instance.positions.get(String(node.id)) ?? node.position)]; position[0] = selected;
    instance.positions.set(String(node.id), position);
    result.decisions.push({ type: 'RandomizeOffset', scope: instance.scope, nodeId: node.id, draw, offsets, selected, source: script.source });
  }

  nodeMatrix(instance, node) {
    const lineage = [];
    for (let current = node; current; current = instance.indexed.nodes.get(String(current.parentId))) lineage.unshift(current);
    const matrix = instance.parentMatrix.clone();
    for (const current of lineage) {
      const root = instance.indexed.roots.includes(String(current.id));
      const local = root && instance.prefab ? new Matrix4().makeScale(...current.scale)
        : unityLocalMatrix({ ...current, position: instance.positions.get(String(current.id)) ?? current.position });
      matrix.multiply(local);
    }
    return matrix;
  }

  selectSpawnPoint(instance, node, script, result) {
    const fields = script.decodedFields;
    const nativeZ = Math.fround(this.nodeMatrix(instance, node).elements[14]);
    const { selected, decision } = this.spawnPointManager.select(fields, nativeZ, this.random);
    result.decisions.push({ ...decision, scope: instance.scope, nodeId: node.id, source: script.source });
    // SpawnSelectedTarget deactivates every unselected referenced GO, even if
    // it is outside the Selector's direct children.
    for (const item of this.spawnPointManager.pickups) {
      const ref = fields[item.field]?.ref;
      if (!ref) continue;
      const target = this.library.objectIndex?.[ref];
      const child = instance.indexed.nodes.get(String(target?.nodeId))
        ?? instance.graph.nodes.find(candidate => String(candidate.gameObjectId) === String(fields[item.field].pathId));
      if (!child) throw new Error(`Unresolved SpawnPoint target: ${ref}`);
      this.setNodeActive(instance, String(child.id), item === selected, result);
      if (item === selected) {
        if (!item.powerup || !this.enabledPowerups.has(item.powerup)) {
          result.diagnostics.push({ kind: 'selected-pickup-effect-unavailable', class: 'SpawnPointManager', field: item.field, powerupType: item.type, powerup: item.powerup, nativeZ, source: script.source });
        } else {
          instance.powerups.set(String(child.id), { ...item, spawnNode: node, selectorSource: script.source });
        }
      }
    }
  }

  performSelections(instance, selectorIds, result) {
    for (const id of selectorIds) {
      if (instance.visited.has(id)) continue;
      instance.visited.add(id);
      const item = instance.selectors.find(candidate => candidate.script.id === id);
      if (!item || !this.isNodeActive(instance, String(item.node.id))) continue;
      const { node, script } = item, children = instance.indexed.children.get(String(node.id));
      if (!instance.initialized.has(id)) {
        for (const child of children) this.setNodeActive(instance, child, false, result);
        instance.initialized.add(id);
      }
      if (script.class === 'Randomizer') {
        const probability = script.decodedFields._activationProbability;
        const activationDraw = this.random(), indexDraw = this.random(), selectedIndex = Math.floor(indexDraw * children.length);
        const selected = activationDraw < probability && children.length ? children[selectedIndex] : null;
        if (selected != null) this.setNodeActive(instance, selected, true, result);
        result.decisions.push({ type: 'Randomizer', scope: instance.scope, nodeId: node.id, activationDraw, indexDraw, probability, selectedIndex, selected, source: script.source });
      }
      if (script.class === 'SpawnPoint') {
        this.selectSpawnPoint(instance, node, script, result);
      }
      const provider = node.scripts.find(component => component.class === 'PlaceholderPrefabProvider');
      const lifecycle = node.scripts.find(component => component.class === 'SelectionPlaceholderLifecycle' || component.class === 'ModelSelectionPlaceholderLifecycle');
      if (provider && lifecycle) {
        const fields = lifecycle.decodedFields;
        if (fields._locatedInIntro && fields._dontSpawnInIntro) continue;
        const draw = this.random(), spawn = draw <= fields._spawnProbability;
        result.decisions.push({ type: 'SelectionPlaceholderLifecycle', scope: instance.scope, nodeId: node.id, draw, probability: fields._spawnProbability, spawn, source: lifecycle.source });
        if (!spawn) continue;
        const target = provider.serializedPrefabPointerAtOffset32 ?? provider.target;
        const key = provider.providerRef ?? target?.definition ?? (target?.asset && target.pathId ? `${target.asset}:${target.pathId}` : null);
        const graph = this.definitions[key];
        if (!graph) throw new Error(`Unresolved source prefab at ${instance.scope}/${node.id}: ${key}`);
        const spawned = this.createInstance(graph, `${instance.scope}/${node.id}:${key}`, true, result, instance.depth + 1);
        spawned.parentMatrix = this.nodeMatrix(instance, node);
        spawned.trainSpeedRatio = node.scripts.find(component => component.class === 'MovingTrainPlaceholder')?.decodedFields?._speed;
        instance.spawned.set(String(node.id), [spawned]);
        // The actual PlaceholderPrefab component supplies its initialized DFS
        // selector cache. Non-Prefab fallback is handled separately as BFS.
        const hasPrefab = graph.nodes.some(n => n.scripts.some(s => s.class === 'PlaceholderPrefab'));
        const selectors = hasPrefab ? spawned.selectors : this.breadthFirstSelectors(spawned);
        this.performSelections(spawned, selectors.map(item => item.script.id), result);
      }
    }
  }

  breadthFirstSelectors(instance) {
    const queue = [...instance.indexed.roots], selectors = [];
    for (let index = 0; index < queue.length; index++) {
      const node = instance.indexed.nodes.get(queue[index]);
      for (const script of node.scripts) if (['Selector', 'Randomizer', 'SpawnPoint'].includes(script.class)) selectors.push({ node, script });
      queue.push(...instance.indexed.children.get(String(node.id)));
    }
    return selectors;
  }

  activateTrackObjects(instance, result) {
    for (const node of instance.graph.nodes) {
      if (!this.isNodeActive(instance, String(node.id))) continue;
      const mirror = node.scripts.find(script => script.class === 'Mirror');
      if (mirror) {
        const draw = this.random(), sign = Math.floor(draw * 2) * 2 - 1;
        for (const childId of instance.indexed.children.get(String(node.id))) {
          const child = instance.indexed.nodes.get(childId), key = `${instance.scope}/${node.id}/${childId}`;
          const position = [...(instance.positions.get(childId) ?? child.position)];
          position[0] = (this.mirrorState.get(key) ?? position[0]) * sign;
          instance.positions.set(childId, position); this.mirrorState.set(key, position[0]);
        }
        result.decisions.push({ type: 'Mirror', scope: instance.scope, nodeId: node.id, draw, sign, source: mirror.source });
      }
      for (const spawned of instance.spawned.get(String(node.id)) ?? []) this.activateTrackObjects(spawned, result);
    }
  }

  emitInstance(instance, parentMatrix, context, result) {
    const { graph, scope, prefab } = instance;
    const deferredCoins = [], matrices = new Map(), localOverrides = new Map(), motions = new Map();
    walkGraph(graph, {
      parentMatrix, rootTransform: prefab ? 'spawned' : 'preserve', resolveNode: args => {
        const decision = { active: instance.active.get(String(args.node.id)) };
        if (instance.positions.has(String(args.node.id))) decision.localMatrix = unityLocalMatrix({ ...args.node, position: instance.positions.get(String(args.node.id)) });
        if (localOverrides.has(String(args.node.id))) decision.localMatrix = localOverrides.get(String(args.node.id));
        if (prefab && args.node.parentId == null) decision.active = true;
        return decision;
      },
      visit: ({ node, matrix, path }) => {
        matrices.set(String(node.id), matrix);
        const inheritedMotion = motions.get(String(node.id)) ?? motions.get(String(node.parentId)) ?? context.motion;
        if (inheritedMotion) motions.set(String(node.id), inheritedMotion);
        const moving = node.scripts?.find(script => script.class === 'MovingTrain');
        const ratio = moving ? context.trainSpeedRatio ?? moving.decodedFields.speed : null;
        if (moving && node.childIds?.length) {
          const child = graph.nodes.find(item => String(item.id) === String(node.childIds[0]));
          const rootZ = matrix.elements[14], playerZ = (context.playerDistance ?? 0) / this.unitScale;
          localOverrides.set(String(child.id), unityLocalMatrix({ ...child, position: [0, 0, (rootZ - playerZ) * ratio] }));
          motions.set(String(child.id), { id: `${scope}/${node.id}`, ratio, referencePlayerDistance: context.playerDistance ?? 0 });
          result.decisions.push({ type: 'MovingTrain', scope, nodeId: node.id, ratio, rootZ, playerZ, dynamicChildId: child.id, source: moving.source });
        }
        const provenance = { asset: graph.source?.asset, nodeId: node.id, graph: scope, path, nativeMatrix: rowMajor(matrix), chunkStart: context.startDistance };
        const pickup = instance.powerups.get(String(node.id));
        if (pickup) {
          const trigger = pickup.spawnNode.colliders.find(collider => collider.type === 'SphereCollider' && collider.fields.m_IsTrigger && collider.fields.m_Enabled);
          if (!trigger) throw new Error(`Selected source pickup has no SpawnPoint trigger: ${scope}/${node.id}`);
          const triggerMatrix = matrices.get(String(pickup.spawnNode.id)) ?? this.nodeMatrix(instance, pickup.spawnNode);
          const c = trigger.fields.m_Center;
          const center = new Vector3(c.x, c.y, c.z).applyMatrix4(triggerMatrix).multiplyScalar(this.unitScale);
          const scales = new Vector3().setFromMatrixScale(triggerMatrix);
          const radius = trigger.fields.m_Radius * Math.max(Math.abs(scales.x), Math.abs(scales.y), Math.abs(scales.z)) * this.unitScale;
          const position = new Vector3().setFromMatrixPosition(matrix).multiplyScalar(this.unitScale);
          const anchor = { x: position.x, distance: position.z };
          result.entities.push({ type: 'powerup', powerup: pickup.powerup, powerupType: pickup.type, ...anchor, y: center.y,
            sourcePickupTrigger: { center: center.toArray(), radius },
            visual: { prefabKey: `powerup_${pickup.powerup}`, matrix: visualMatrix(matrix, anchor, this.unitScale) },
            provenance: { ...provenance, selector: pickup.selectorSource, trigger: trigger.source, sourceGameObject: `${graph.source.asset}:${node.gameObjectId}` } });
        }
        for (const script of node.scripts) {
          if (script.class === 'Environment' || script.class === 'EnvironmentBase') result.environmentRegions.push({ kind: script.class, fields: script.decodedFields, nativeMatrix: rowMajor(matrix), source: script.source });
          if (script.class === 'DeselectMeComponent') result.diagnostics.push({ kind: 'runtime-effect-unconfirmed', class: script.class, fields: script.decodedFields, source: script.source, provenance });
          // HBumpProperty speed-loss hooks are guarded by Game.IsNoDieStumble.
          // Native method 36407 returns false for ordinary classic mode; they
          // belong to PvP/high-score/challenge/Rogue no-death modes.
        }
        for (const collider of node.colliders ?? []) {
          let fields = collider.fields ?? collider;
          const sourceCollision = this.library.collisionTags?.byColliderRef?.[`${collider.source?.asset}:${collider.source?.pathId}`];
          const tunnel = node.scripts.find(script => script.class === 'Tunnel');
          if (tunnel && fields.m_Enabled !== false && fields.m_IsTrigger && collider.type === 'BoxCollider') {
            const bounds = colliderBounds(fields, matrix, this.unitScale);
            result.entities.push({ type: 'decoration', ...bounds, visual: null, sourceIsTrigger: true,
              sourceShape: colliderShape(fields, matrix, bounds, this.unitScale),
              tunnelModifier: { length: tunnel.decodedFields._tunnelLength * this.unitScale },
              provenance: { ...provenance, collider: collider.source, tunnel: tunnel.source } });
            continue;
          }
          if (fields.m_Enabled !== false && fields.m_IsTrigger && sourceCollision?.tag === 'Subway' && collider.type === 'BoxCollider') {
            const bounds = colliderBounds(fields, matrix, this.unitScale);
            // Character.OnCharacterTriggerEnter81966: bounds.max.y - 3 native.
            // A source trigger is not a hazard. Keeping decoration type also
            // prevents the existing core collision dispatcher from killing on it.
            result.entities.push({ type: 'decoration', ...bounds, visual: null,
              sourceTag: sourceCollision.tag, sourceLayer: sourceCollision.layer, sourceIsTrigger: true,
              sourceShape: colliderShape(fields, matrix, bounds, this.unitScale),
              cameraVolume: { kind: 'Subway', maxY: bounds.height - 3 * this.unitScale },
              provenance: { ...provenance, collider: collider.source } });
            continue;
          }
          if (fields.m_Enabled === false || fields.m_IsTrigger && sourceCollision?.layer !== 'Hit') continue;
          if (!['BoxCollider', 'CapsuleCollider'].includes(collider.type)) { result.diagnostics.push({ kind: 'unsupported-collider', type: collider.type, provenance }); continue; }
          if (moving && collider.type === 'BoxCollider') fields = { ...fields, m_Size: { ...fields.m_Size, z: fields.m_Size.z / (1 + ratio) }, m_Center: { x: 0, y: 15.2, z: (30 * moving.decodedFields.trainCount + 1) / (1 + ratio) } };
          const bounds = collider.type === 'BoxCollider' ? colliderBounds(fields, matrix, this.unitScale) : capsuleBounds(fields, matrix, this.unitScale);
          const rootName = graph.source?.name ?? graph.resourceName ?? '';
          const ramp = rootName.includes('train_ramp') && (node.name === 'collider' || node.name === 'colliderCapsule');
          const train = /trains?_/.test(rootName) && !rootName.includes('ramp') || rootName.includes('ramp') && node.name === 'topCollider';
          const type = ramp ? 'ramp' : train ? 'train' : 'obstacle';
          result.entities.push({ type, ...bounds, sourceTag: sourceCollision?.tag, sourceLayer: sourceCollision?.layer, sourceIsTrigger: !!fields.m_IsTrigger, sourceShape: colliderShape(fields, matrix, bounds, this.unitScale), visual: null, walkable: train,
            ...(moving ? { movingTrainProxy: { motionId: `${scope}/${node.id}`, ratio } } : {}),
            ...this.motionFields(inheritedMotion, bounds.distance), provenance: { ...provenance, collider: collider.source, movingProxyRatio: moving ? ratio : undefined } });
        }
        const coinCurve = node.scripts?.find(script => script.class === 'CoinCurve');
        if (coinCurve) deferredCoins.push({ node, script: coinCurve, matrix, provenance, motion: inheritedMotion });
        for (const spawned of instance.spawned.get(String(node.id)) ?? []) this.emitInstance(spawned, matrix, { ...context, motion: inheritedMotion, trainSpeedRatio: spawned.trainSpeedRatio ?? context.trainSpeedRatio }, result);
        const bindingKey = graph.id ?? (graph.source?.asset && (graph.source?.pathId ?? graph.source?.path_id) ? `${graph.source.asset}:${graph.source.pathId ?? graph.source.path_id}` : null);
        const binding = graph.visualBinding ?? graph.modelBinding ?? this.library.modelBindings?.byDefinitionRef?.[bindingKey];
        if (binding && node.parentId == null) {
          const position = new Vector3().setFromMatrixPosition(matrix).multiplyScalar(this.unitScale);
          const anchor = { x: position.x, distance: position.z };
          result.entities.push({ type: 'decoration', ...anchor, ...this.motionFields(inheritedMotion, anchor.distance), visual: { prefabKey: binding.prefabKey, matrix: visualMatrix(matrix, anchor, this.unitScale) }, provenance });
        }
      },
    });
    for (const curve of deferredCoins) this.compileCoins(curve, graph, matrices, context, result);
  }

  motionFields(motion, distance) {
    return motion ? { motionId: motion.id, movingTrain: { ratio: motion.ratio, referencePlayerDistance: motion.referencePlayerDistance, initialDistance: distance } } : {};
  }

  compileCoins({ node, script, matrix, provenance, motion }, graph, matrices, context, result) {
    const fields = script.decodedFields;
    if (!fields) throw new Error(`Missing CoinCurve fields: ${script.id}`);
    const ref = fields._curveParent?.ref;
    const source = this.library.objectIndex?.[ref];
    const curveNode = source && graph.nodes.find(item => String(item.id) === String(source.nodeId));
    const curveScript = curveNode?.scripts.find(item => item.class === 'CurveParent');
    const cachedCurve = curveScript?.decodedFields?._cachedCurve;
    const curve = cachedCurve && initializeCoinCurve(cachedCurve);
    const curveMatrix = curveNode && matrices.get(String(curveNode.id));
    const nativeSpeed = context.speed / this.unitScale;
    const speedScale = fields._scaleMode === 0 ? 1 : nativeSpeed / 110;
    const spacing = coinSpacingAtSpeed(fields, nativeSpeed);
    const nativeLength = curve ? (sampleSourceCurve(curve, 1)[2] - sampleSourceCurve(curve, 0)[2]) * speedScale : 0;
    const beforeSkip = Math.floor(Math.abs(nativeLength) / spacing) + 1;
    const skip = fields._coinIndexToSkip;
    const count = beforeSkip - (skip >= 0 && skip < beforeSkip ? 1 : 0);
    const own = new Vector3().setFromMatrixPosition(matrix);
    if (ref && (!curve || !curveMatrix)) throw new Error(`CoinCurve references an unavailable active CurveParent: ${ref}`);
    const rule = {
      fields, curve, matrix: curveMatrix && rowMajor(curveMatrix), own: own.toArray(), count, nativeSpeed,
      start: curve && vector(sampleSourceCurve(curve, curve._minTime ?? 0)).applyMatrix4(curveMatrix).toArray(),
      end: curve && vector(sampleSourceCurve(curve, curve._maxTime ?? 1)).applyMatrix4(curveMatrix).toArray(),
    };
    for (let index = 0; index < beforeSkip; index++) {
      if (index === skip) continue;
      const point = curvePointForCoin(rule, index, nativeSpeed, false);
      result.entities.push({ type: 'coin', x: point[0] * this.unitScale, y: (point[1] + 6) * this.unitScale, distance: point[2] * this.unitScale,
        coinCurve: { rule, sourceIndex: index },
        ...this.motionFields(motion, point[2] * this.unitScale),
        provenance: { ...provenance, component: script.id, coinIndex: index, coinsAtSpawn: count, curvePosition: point, modelCenterY: 6 } });
    }
    result.decisions.push({ type: 'CoinCurve', scope: provenance.graph, nodeId: node.id, source: script.source, speed: nativeSpeed, spacing, signedLength: nativeLength, count, skippedIndex: skip, scaleMode: fields._scaleMode });
  }

  /**
   * Explicit Game.RegisterSpeedChange event, used by Activate/DeactivateHighSpeed.
   * The ordinary classic speed ramp does not dispatch this event. Reposition
   * existing coins only; native Game_OnSpeedChanged never resizes their list.
   */
  onSpeedChanged(entities, speed, playerDistance = 0) {
    const nativeSpeed = speed / this.unitScale, groups = new Map();
    for (const entity of entities) {
      if (entity.type !== 'coin' || entity.collected || !entity.coinCurve) continue;
      const rule = entity.coinCurve.rule;
      if (!groups.has(rule)) groups.set(rule, []);
      groups.get(rule).push(entity);
    }
    let updated = 0;
    for (const [rule, placed] of groups) {
      placed.sort((a, b) => a.coinCurve.sourceIndex - b.coinCurve.sourceIndex);
      const offset = rule.count - placed.length, skip = rule.fields._coinIndexToSkip;
      const scale = rule.fields._scaleMode === 0 ? 1 : nativeSpeed / 110;
      const length = rule.curve ? (sampleSourceCurve(rule.curve, 1)[2] - sampleSourceCurve(rule.curve, 0)[2]) * scale : 0;
      const countAtSpeed = Math.floor(Math.abs(length) / coinSpacingAtSpeed(rule.fields, nativeSpeed)) + 1;
      const isSkipping = skip >= 0 && skip < countAtSpeed;
      for (let j = 0; j < placed.length; j++) {
        const curveIndex = offset + j;
        if (curveIndex === skip) continue;
        const listIndex = j - (isSkipping && j > skip ? 1 : 0), entity = placed[listIndex];
        if (!entity) continue;
        const point = curvePointForCoin(rule, curveIndex, nativeSpeed, true);
        entity.x = point[0] * this.unitScale; entity.y = (point[1] + 6) * this.unitScale;
        entity.distance = point[2] * this.unitScale;
        if (entity.movingTrain) {
          entity.movingTrain.initialDistance = entity.distance;
          entity.distance -= (playerDistance - entity.movingTrain.referencePlayerDistance) * entity.movingTrain.ratio;
        }
        updated++;
      }
    }
    return updated;
  }

  weightedEntries(container) { return container?._weightedPrefabs ?? []; }

  pick(entries, evaluator, scope, decisions) {
    if (!entries.length) return null;
    if (!this.picker) throw new Error('The recovered ordered weighted picker has not yet been integrated');
    return this.picker({ entries, evaluator, scope, random: this.random, state: this.pickerState, decisions });
  }

  sectionObject(ref) {
    const object = this.settings.objects[ref];
    if (!object) throw new Error(`Source RouteSection is missing: ${ref}`);
    return object;
  }

  entryChunkId(entry) {
    const id = entry?.prefabPath?.toLowerCase() || this.library.routeRefs?.[entry?.Prefab?.ref];
    if (!id) throw new Error(`Source weighted chunk reference is unresolved: ${entry?._name}`);
    return id;
  }

  /**
   * Browser queue-packing adapter, not a complete EnqueueBuildDirective port.
   * Source landing grid/chunk is 180 native units. Already-built chunks stay
   * intact, and the current section's minimum length remains respected.
   */
  scheduleJetpackLanding(requestedTarget, leadingEdge, landingRunout = 0) {
    if (![requestedTarget, leadingEdge, landingRunout].every(Number.isFinite) || requestedTarget < 0 || leadingEdge < 0 || landingRunout < 0) throw new Error('Invalid Jetpack landing position');
    const grid = 180 * this.unitScale;
    const sectionMinimum = this.currentSection
      ? this.currentSection.startDistance + this.currentSection.fields._lengthMin * this.unitScale : 0;
    const align = value => Math.ceil((value - 1e-9) / grid) * grid;
    const target = align(Math.max(align(requestedTarget), leadingEdge, sectionMinimum));
    this.pendingJetpackLanding = { requestedTarget, target, leadingEdgeAtRequest: leadingEdge,
      currentSectionMinimum: sectionMinimum, landingRunout, adapter: 'browser-queue-packing' };
    return target;
  }

  fallbackChunkId() {
    const builder = this.settings.objects[this.settings.roots.defaultRoute].fields._defaultRouteBuilder;
    const fallback = this.sectionObject(builder._fallbackSection.ref);
    return this.entryChunkId(this.weightedEntries(fallback.fields._midChunks)[0]);
  }

  compileJetpackLanding(context) {
    const request = this.pendingJetpackLanding;
    const builder = this.settings.objects[this.settings.roots.defaultRoute].fields._defaultRouteBuilder;
    const sectionId = builder._jetpackEndSection.ref, section = this.sectionObject(sectionId);
    const chunkId = 'routes/default/chunks/routechunk_default_jetpack_landing';
    const chunk = this.compileChunk(chunkId, { ...context, sectionId, sectionFields: section.fields });
    if (Math.abs(chunk.length - 180 * this.unitScale) > 1e-7) throw new Error('Source Jetpack landing chunk must be 180 units');
    chunk.provenance.sectionId = sectionId;
    chunk.provenance.sectionName = section.name;
    chunk.provenance.phase = 'jetpack-landing';
    chunk.provenance.jetpackLanding = { ...request, kind: 'landing' };
    chunk.decisions.unshift({ type: 'JetpackLandingAdapter', ...request, chunkId });
    this.pendingJetpackLanding = null;
    const blocks = Math.ceil(Math.max(0, request.landingRunout - chunk.length) / (180 * this.unitScale));
    if (blocks) this.landingSafetyPadding = { ...request, remainingBlocks: blocks, blockCount: blocks,
      nextStart: context.startDistance + chunk.length };
    // Resume the original section pools after this inserted transition. The
    // already-emitted part of the previous section is never rebuilt or removed.
    this.currentSection = null;
    return chunk;
  }

  compileLandingSafetyPadding(context) {
    const request = this.landingSafetyPadding;
    if (Math.abs(context.startDistance - request.nextStart) > 1e-7) throw new Error('Landing safety padding must follow the source landing chunk');
    const builder = this.settings.objects[this.settings.roots.defaultRoute].fields._defaultRouteBuilder;
    const sectionId = builder._fallbackSection.ref, section = this.sectionObject(sectionId);
    const chunk = this.compileChunk(this.fallbackChunkId(), { ...context, sectionId, sectionFields: section.fields });
    if (Math.abs(chunk.length - 180 * this.unitScale) > 1e-7) throw new Error('Landing safety filler must use an unmodified 180-unit source fallback');
    chunk.provenance.sectionId = sectionId;
    chunk.provenance.sectionName = section.name;
    chunk.provenance.phase = 'landing-safety-padding';
    chunk.provenance.jetpackLanding = { ...request, kind: 'landing-safety-padding', adapter: 'browser-landing-runout' };
    chunk.decisions.unshift({ type: 'LandingRunoutAdapter', ...chunk.provenance.jetpackLanding });
    request.nextStart += chunk.length;
    if (--request.remainingBlocks === 0) this.landingSafetyPadding = null;
    return chunk;
  }

  beginSection(context, decisions) {
    const defaultRoute = this.settings.objects[this.settings.roots.defaultRoute];
    const builder = defaultRoute.fields._defaultRouteBuilder;
    let sectionId;
    const nativeZ = context.startDistance / this.unitScale;
    if (this.sectionCount === 0) {
      sectionId = builder._startSectionPrefabs.find(item => item.TransitionRouteType === 0)?.Section.ref;
      if (this.pendingJetpackLanding && this.sectionObject(sectionId).fields._lengthMin * this.unitScale > this.pendingJetpackLanding.target - context.startDistance + 1e-7) sectionId = builder._fallbackSection.ref;
    } else {
      const entries = [...this.weightedEntries(builder._midSectionPrefabs)];
      for (const pointer of builder._midSectionGroupPrefabs) entries.push(...this.settings.objects[pointer.ref].fields._routeSections);
      const selected = this.pick(entries, entry => {
        const ref = entry.Prefab.ref, section = this.sectionObject(ref);
        if (this.pendingJetpackLanding && section.fields._lengthMin * this.unitScale > this.pendingJetpackLanding.target - context.startDistance + 1e-7) return false;
        const eligibility = sectionEligibility(section.fields, this.sectionStates.get(ref) ?? {}, {
          z: nativeZ, sectionCountUsed: this.sectionCount, minimumRepeatDistance: builder._minDistanceBetweenSectionRepeats,
          lastSection: this.lastSection, excludedPreviousSections: section.fields._repeatConfiguration._doNotSpawnAfter.map(item => item.ref),
        });
        return eligibility.allowed;
      }, 'default-mid-sections', decisions);
      sectionId = selected?.Prefab.ref ?? builder._fallbackSection.ref;
      const section = this.sectionObject(sectionId);
      recordSectionSpawn(this.sectionStates, sectionId, section.fields, nativeZ, section.fields._lengthMax);
    }
    if (!sectionId) throw new Error('DefaultRoute contains no ordinary start section');
    const section = this.sectionObject(sectionId), fields = section.fields;
    const draw = this.random();
    const middleTarget = fields._middleChunkCountMin + Math.floor(draw * (fields._middleChunkCountMax - fields._middleChunkCountMin + 1));
    const pools = [this.weightedEntries(fields._startChunks), this.weightedEntries(fields._midChunks), this.weightedEntries(fields._endChunks)];
    let phase = 0;
    while (phase < 3 && !pools[phase].length) phase++;
    this.currentSection = { id: sectionId, object: section, fields, pools, phase, middleTarget, middleUsed: 0, picked: new Set(), startDistance: context.startDistance };
    this.sectionCount++;
    this.lastSection = sectionId;
    decisions.push({ type: 'RouteSection', sectionId, name: section.name, nativeZ, sectionCountUsed: this.sectionCount, targetDraw: draw, middleTarget, source: section.source });
  }

  nextChunk(context) {
    if (this.landingSafetyPadding) return this.compileLandingSafetyPadding(context);
    const decisions = [];
    const landing = this.pendingJetpackLanding;
    if (landing) {
      if (context.startDistance > landing.target + 1e-7) throw new Error('Course builder passed the scheduled Jetpack landing boundary');
      if (Math.abs(context.startDistance - landing.target) <= 1e-7) return this.compileJetpackLanding(context);
    }
    if (!this.currentSection || this.currentSection.phase === 3) this.beginSection(context, decisions);
    const section = this.currentSection, phase = section.phase;
    const entry = this.pick(section.pools[phase], candidate => {
      const id = this.entryChunkId(candidate), graph = this.resolveChunk(id);
      if (landing && context.startDistance + (graph.verifiedChunkLength ?? graph.length) * this.unitScale > landing.target + 1e-7) return false;
      return graph.routeChunkFields._isRepeatableInSections || !section.picked.has(id);
    }, `${section.id}/phase-${phase}`, decisions);
    let chunkId;
    if (entry) chunkId = this.entryChunkId(entry);
    else {
      chunkId = this.fallbackChunkId();
      decisions.push({ type: 'FallbackChunk', chunkId, reason: 'ordered-picker-returned-null' });
    }
    if (landing && context.startDistance + this.resolveChunk(chunkId).length * this.unitScale > landing.target + 1e-7) throw new Error('Source fallback chunk cannot fit the pending Jetpack landing gap');
    if (phase === 1) section.middleUsed++;
    if (!(phase === 1 && (!section.fields._middleChunkCountLimited || section.middleUsed < section.middleTarget))) {
      section.phase++;
      while (section.phase < 3 && !section.pools[section.phase].length) section.phase++;
    }
    section.picked.add(chunkId);
    const chunk = this.compileChunk(chunkId, { ...context, sectionId: section.id, sectionFields: section.fields });
    chunk.provenance.sectionId = section.id;
    chunk.provenance.sectionName = section.object.name;
    chunk.provenance.phase = phase;
    if (landing) chunk.provenance.jetpackLanding = { ...landing, kind: entry ? 'approach' : 'padding' };
    chunk.decisions.unshift(...decisions);
    return chunk;
  }
}
