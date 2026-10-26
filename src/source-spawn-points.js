// Native fallback evidence: analysis/powerups/spawning/findings.json.
// Distances here are Unity game-position units, before the renderer's 0.1 scale.
// List order is SpawnPointManager::.ctor 24074, not SpawnPoint field order.
export const SOURCE_PICKUPS = Object.freeze([
  { field: 'characterLetter', type: 31, weight: 25, minimumMeters: 0 },
  { field: 'dailyLetter', type: 10, weight: 1500000000, minimumMeters: 0 },
  { field: 'doubleScoreMultiplier', type: 11, powerup: 'doubleScore', weight: 29, minimumMeters: 0 },
  { field: 'jetpackPickup', type: 7, powerup: 'jetpack', weight: 14, minimumMeters: 1000 },
  { field: 'jumpBooster', type: 8, powerup: 'sneakers', weight: 26, minimumMeters: 0 },
  { field: 'magnetBooster', type: 9, powerup: 'magnet', weight: 29, minimumMeters: 0 },
  { field: 'saveMeToken', type: 18, weight: 2, minimumMeters: 1000 },
  { field: 'mysteryBox', type: 5, weight: 12, minimumMeters: 99999 },
  { field: 'mysteryPowerup', type: 25, weight: 23, minimumMeters: 0 },
  { field: 'hourglass', type: 38, weight: 12, minimumMeters: 0 },
  { field: 'scoreMulPearl', type: 39, weight: 12, minimumMeters: 0 },
  { field: 'allInOne', type: 41, weight: 12, minimumMeters: 0 },
].map(Object.freeze));

/**
 * Classic native SpawnPointManager. Account/event state is explicit: the browser
 * has no live daily-word or seasonal-event account, so those three weights are
 * zero unless the caller supplies the corresponding recovered eligibility.
 * Effect support never removes a candidate or changes the original draw.
 */
export class SourceSpawnPointManager {
  constructor({ characterLetterSpawnable = false, dailyLetterAvailable = false, mysteryPowerupEventActive = false } = {}) {
    this.eventState = { characterLetterSpawnable, dailyLetterAvailable, mysteryPowerupEventActive };
    this.reset();
  }

  reset() {
    this.nextZ = 2000;
    this.spacing = 2400;
    this.pickups = SOURCE_PICKUPS.map(item => ({ ...item, nextZ: -3.4028234663852886e38, canSpawn: true }));
  }

  select(fields, nativeZ, random, { compulsory = false } = {}) {
    if (!Number.isFinite(nativeZ)) throw new Error('SpawnPoint game position must be finite');
    // PerformSelection 24081 invokes these event checks before its distance gate.
    const events = this.eventState;
    this.pickups.find(item => item.type === 31).weight = events.characterLetterSpawnable ? 25 : 0;
    this.pickups.find(item => item.type === 10).weight = events.dailyLetterAvailable ? 1500000000 : 0;
    this.pickups.find(item => item.type === 25).weight = events.mysteryPowerupEventActive ? 23 : 0;
    const decision = { type: 'SpawnPoint', nativeZ, globalNextZBefore: this.nextZ, compulsory, candidates: [], draw: null, selected: null };
    if (!(nativeZ > this.nextZ) && !compulsory) return { selected: null, decision };
    let totalWeight = 0;
    // Predicate 24109 deliberately does NOT include canSpawn. That flag is
    // checked only while scanning cumulative weights after drawing.
    const candidates = this.pickups.filter(item => item.nextZ < nativeZ && item.weight > 0 && fields[item.field]?.ref);
    decision.candidates = candidates.map(item => ({ field: item.field, type: item.type, weight: item.weight, cumulative: totalWeight += item.weight, nextZ: item.nextZ }));
    if (!candidates.length) return { selected: null, decision };
    const draw = random();
    // SyboRandom.Range(0, totalWeight + 1) is an integer draw; the scan uses <=.
    const ticket = Math.floor(draw * (totalWeight + 1));
    decision.draw = draw; decision.ticket = ticket; decision.totalWeight = totalWeight;
    const selected = candidates.find((item, index) => ticket <= decision.candidates[index].cumulative && item.canSpawn && fields[item.field]?.ref) ?? null;
    if (selected) {
      selected.nextZ = Math.fround(nativeZ + selected.minimumMeters * 8);
      decision.selected = selected.field;
      decision.typeNextZ = selected.nextZ;
    }
    // Even a rejected selection advances the global threshold; an empty
    // candidate list above does not (24079 branches at 0x28fa7e8 / 0x28fa9a8).
    this.nextZ = Math.fround(nativeZ + this.spacing);
    decision.globalNextZAfter = this.nextZ;
    return { selected, decision };
  }
}
