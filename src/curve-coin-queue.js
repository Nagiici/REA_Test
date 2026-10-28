/** CoinCurve82790..82797: one index per Update, separate from route worker.
 * Counts are sampled at activation; positions use current level speed. */
export class CurveCoinQueue {
  constructor() { this.reset(); }
  reset() { this.rows = new Map(); this.nextId = 0; }
  activate({ count, skip, origin, flight, endDistance, createCoin, owner }) {
    if (flight?.active && origin[2] <= flight.targetZ) return null;
    const id = this.nextId++;
    this.rows.set(id, { id, count, skip, origin, endDistance, createCoin, owner, index: -1, spawning: true });
    return id;
  }
  cancel(id) { const row = this.rows.get(id); if (row) row.spawning = false; }
  flightStarted() {
    const stopped = new Set();
    for (const row of this.rows.values()) if (row.origin[1] > 7) { row.spawning = false; stopped.add(row.id); }
    return stopped;
  }
  retireActivation(key) {
    for (const [id,row] of this.rows) if (row.owner.key === key) this.rows.delete(id);
  }
  update(context) {
    const emitted = [];
    for (const [id, row] of this.rows) {
      if (!row.spawning) continue;
      const index = ++row.index;
      if (index < row.count && index !== row.skip) {
        const entity = row.createCoin(index, context);
        entity.coinCurve.rowId = id;
        entity.routeActivation = { ...row.owner, playerDistance: context.playerDistance, coinIndex: index };
        emitted.push(entity);
      }
      // Native skipped-index branch returns before finalization. If the last
      // index is skipped, the next Update observes index==count and stops.
      if (index >= row.count || index === row.count - 1 && index !== row.skip) row.spawning = false;
    }
    return emitted;
  }
}
