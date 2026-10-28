import { seededRandom, SemiRandomlyOrderedList } from './route-generator.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const kindKey = kind => `${kind._type}:${kind._density}`;
const sameKind = (a, b) => a && b && kindKey(a) === kindKey(b);

// EnvironmentInfo::.cctor 0x22ef838, constructor 0x22ef52c and
// GetSequenceLengthInBlocks 0x22ef6f8. Lengths are blocks of 90 Unity units.
export const environmentInfo = {
  1: { mid: 2, end: 0, sides: true, sameVariation: false },
  2: { mid: 2, end: 0, sides: false, sameVariation: true },
  4: { mid: 2, end: 1, sides: false, sameVariation: true },
  8: { mid: 4, end: 0, sides: false, sameVariation: false },
  16: { mid: 2, end: 1, sides: false, sameVariation: true },
  32: { mid: 4, end: 4, sides: false, sameVariation: true },
};

export function environmentPieces(kind, blocks) {
  const info = environmentInfo[kind._type];
  if (!info || blocks <= 0) return [];
  const pieces = [];
  let cursor = 0;
  if (info.end) {
    pieces.push({ part: 'Start', startBlock: cursor, blocks: info.end });
    cursor += info.end;
  }
  const endAt = blocks - info.end;
  while (cursor < endAt) {
    pieces.push({ part: 'Mid', startBlock: cursor, blocks: info.mid });
    cursor += info.mid;
  }
  if (info.end) pieces.push({ part: 'End', startBlock: endAt, blocks: info.end });
  return pieces;
}

export function partitionEnvironment(blocks, desiredKind, regions, startDistance, scale = 0.1) {
  const slots = Array.from({ length: blocks }, () => desiredKind);
  for (const region of regions.filter(region => region.kind === 'Environment')) {
    const start = Math.round((region.nativeMatrix[11] * scale - startDistance) / (90 * scale));
    for (let block = Math.max(0, start); block < Math.min(blocks, start + region.fields._blockCount); block++) slots[block] = region.fields._environmentKind;
  }
  const runs = [];
  for (let block = 0; block < slots.length; block++) {
    const last = runs.at(-1);
    if (last && sameKind(last.kind, slots[block])) last.blocks++;
    else runs.push({ startBlock: block, blocks: 1, kind: slots[block] });
  }
  return runs;
}

function decoration(prefabKey, x, distance, length, provenance) {
  return { type: 'decoration', x, distance, depth: length * 2,
    visual: { prefabKey, matrix: identity }, provenance };
}

export class EnvironmentLayout {
  constructor(bindings, { unitScale = 0.1, seed = 48709 } = {}) {
    this.bindings = bindings;
    this.unitScale = unitScale;
    this.assets = bindings.routeEnvironmentModelAssets.find(group => group.RouteCategory === 0).EnvironmentAssets;
    this.reset(seed);
  }

  reset(seed) {
    // Cosmetic variation is deterministic, independent of gameplay branch RNG.
    this.random = seededRandom(seed ^ 0x51e9a);
  }

  addModels(result, runs, startDistance) {
    for (const run of runs) {
      const record = this.assets.find(asset => sameKind(asset.Environment, run.kind));
      if (!record || !record.SequenceVariations.length) continue;
      const info = environmentInfo[run.kind._type];
      let variation = null;
      for (const piece of environmentPieces(run.kind, run.blocks)) {
        const distance = startDistance + (run.startBlock + piece.startBlock) * 90 * this.unitScale;
        const choose = () => Math.floor(this.random() * record.SequenceVariations.length);
        if (!info.sides && (variation === null || !info.sameVariation)) variation = choose();
        const sides = info.sides ? ['Left', 'Right'] : ['Joint'];
        for (const side of sides) {
          const index = info.sides ? choose() : variation;
          const pointer = record.SequenceVariations[index][piece.part][side];
          if (pointer?.prefabKey) result.entities.push(decoration(pointer.prefabKey, 0, distance, piece.blocks * 90 * this.unitScale,
            { environment: run.kind, part: piece.part, variation: index, themeSource: this.bindings.themeSource, prefabSource: pointer.ref }));
        }
      }
    }
  }
}

// DefaultRouteBuilder.Initialize / EvalNextChunkDesiredEnvironment native
// fallback. Forced kinds in RouteSection describe constraints, while actual
// forced intervals are Environment components inside its chunks.
export class EnvironmentSelector {
  constructor(bindings, seed) {
    this.configs = bindings.environmentRepeatSettings;
    this.random = seededRandom(seed ^ 0x2335048);
    this.bag = new SemiRandomlyOrderedList(this.configs, this.random);
    this.current = this.bag.getNext(this.random);
    this.changeAt = this.current?.RepeatDistance ?? 0;
  }

  next(fields, nativeZ, nativeLength) {
    const allowed = fields._limitedAllowedEnvironmentKinds ?? [];
    const supports = kind => !allowed.length || allowed.some(item => sameKind(item, kind));
    const currentKind = this.current?.EnvironmentKind;
    const valid = currentKind && currentKind._type !== 0;
    const supportsCurrent = valid && supports(currentKind);
    const supportsAny = this.configs.some(item => supports(item.EnvironmentKind));
    const change = this.configs.length && supportsAny
      && ((!supportsCurrent && nativeLength >= 540) || !valid || nativeZ >= this.changeAt);
    if (change) {
      let selected;
      if (allowed.length) {
        this.bag.reset(this.random);
        selected = this.bag.getNextMatching(this.random, item => supports(item.EnvironmentKind)
          && (!sameKind(item.EnvironmentKind, currentKind) || allowed.length === 1));
      } else selected = this.bag.getNext(this.random);
      if (!selected) throw new Error('原版环境配置没有可选条目');
      if (selected !== this.current) {
        this.changeAt = nativeZ + (this.current?.RepeatDistance ?? selected.RepeatDistance);
        this.current = selected;
      }
      return selected.EnvironmentKind;
    }
    if (supportsCurrent) return currentKind;
    if (allowed.length) return allowed[Math.floor(this.random() * allowed.length)];
    throw new Error('原版路段没有可用环境');
  }
}

export class EnvironmentRouteGenerator {
  constructor(source, bindings) {
    this.source = source;
    this.bindings = bindings;
    this.initialDistance = source.initialDistance;
    this.unitScale = source.unitScale;
    this.reset(source.seed);
  }

  reset(seed) {
    this.source.reset(seed);
    this.selector = new EnvironmentSelector(this.bindings, seed);
    this.layout = new EnvironmentLayout(this.bindings, { seed, unitScale: this.unitScale });
  }

  nextChunk(context) {
    return this.decorate(this.source.nextChunk(context), context);
  }

  scheduleJetpackLanding(requestedTarget, leadingEdge, landingRunout = 0) {
    return this.source.scheduleJetpackLanding(requestedTarget, leadingEdge, landingRunout);
  }

  get pendingJetpackLanding() { return this.source.pendingJetpackLanding; }
  get minimumJetpackLandingZ() { return this.source.minimumJetpackLandingZ; }
  reserveJetpackLandingRunout(distance) { this.source.reserveJetpackLandingRunout(distance); }

  decorate(result, context) {
    const fields = result.environmentHints.chunkFields;
    const kind = this.selector.next(fields, context.startDistance / this.unitScale, result.length / this.unitScale);
    const runs = partitionEnvironment(fields._blockCount, kind, result.environmentRegions, context.startDistance, this.unitScale);
    if (fields._generateEnvironment) this.layout.addModels(result, runs, context.startDistance);
    this.addGround(result, runs, context.startDistance);
    result.provenance.environment = kind;
    result.provenance.environmentRuns = runs;
    return result;
  }

  addGround(result, runs, startDistance) {
    if (!result.environmentHints.chunkFields._generateEnvironmentBase) return;
    const blockSize = 90 * this.unitScale;
    const ground = this.bindings.groundAssets;
    const regions = result.environmentRegions.filter(region => region.kind === 'EnvironmentBase');
    for (let block = 0; block < result.environmentHints.chunkFields._blockCount;) {
      const distance = startDistance + block * blockSize;
      const forced = regions.find(region => {
        const start = region.nativeMatrix[11] * this.unitScale;
        return distance >= start - 1e-5 && distance < start + region.fields._blockCount * blockSize - 1e-5;
      });
      const environment = runs.find(run => block >= run.startBlock && block < run.startBlock + run.blocks).kind;
      const numTracks = forced?.fields._numTracks ?? 3;
      let slots, blocks = 2;
      if (environment._type === 32 || forced?.fields._type === 1) { block += 2; continue; }
      if (environment._type === 8) { slots = [null, 'TracksGatesShadow', null]; blocks = 4; }
      else slots = numTracks === 1 ? ['Ground', 'Track', 'Ground']
        : numTracks === 2 ? ['Track', 'Ground', 'Track'] : ['Track', 'Track', 'Track'];
      for (let lane = 0; lane < 3; lane++) {
        const pointer = ground[slots[lane]];
        if (pointer?.prefabKey) result.entities.push(decoration(pointer.prefabKey, (lane - 1) * 20 * this.unitScale, distance, blocks * blockSize,
          { groundSource: pointer.ref, source: forced?.source, tracks: numTracks, environment }));
      }
      block += blocks;
    }
  }
}
