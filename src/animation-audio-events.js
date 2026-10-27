/** Audio events installed at runtime by RunnerAnimPlayer.Initialize. Source
 * frame/sampleRate is clip-local time; it follows speed, replay and looping.
 * Three active-action traversal and positive-weight gating are adapters. */
export class AnimationAudioEvents {
  constructor(data) { this.data = data; this.reset(); }
  reset(snapshot = null) {
    // A new game may cross-fade from the prior game's still-scheduled clip.
    // Seed its cursor so resetting game state cannot replay earlier keyframes.
    this.cursors = new Map((snapshot?.actions ?? []).map(action => [action.name, {
      generation: action.activation ?? action.generation ?? 0,
      time: Math.max(0, action.loopCount ?? 0) * action.duration + action.time,
    }]));
  }
  sample(snapshot, { paused = false, phase = 'running', sneakers = false } = {}) {
    if (paused || !snapshot) return [];
    const result = [];
    for (const action of snapshot.actions ?? []) {
      const events = this.data?.events?.[action.name];
      if (!events?.length || !(action.duration > 0)) continue;
      const generation = action.activation ?? action.generation ?? 0;
      const now = Math.max(0, action.loopCount ?? 0) * action.duration + action.time;
      const previous = this.cursors.get(action.name);
      const before = previous?.generation === generation ? previous.time : -1e-7;
      this.cursors.set(action.name, { generation, time: now });
      if (!action.enabled || !(action.weight > 0) || now < before) continue;
      for (let cycle = Math.max(0, Math.floor(before / action.duration)); cycle <= Math.floor(now / action.duration); cycle++) {
        for (const event of events) {
          const time = cycle * action.duration + event.time;
          if (time <= before + 1e-9 || time > now + 1e-9 || event.menuOnly && phase !== 'ready' || phase === 'ready' && !event.menuOnly) continue;
          result.push({ type: 'animation-audio', animation: action.name,
            binding: sneakers && event.sneakersBinding ? event.sneakersBinding : event.binding,
            time, frame: event.frame });
        }
      }
    }
    return result;
  }
}
