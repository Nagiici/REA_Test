import { AnimationAudioEvents } from './animation-audio-events.js';

/** Source AudioClip bindings; browser playback/volume is a presentation adapter.
 * Nothing plays before the existing user sound toggle resumes AudioContext. */
export class ClassicAudio {
  constructor(data, base = '/assets/recovered/', animationEvents = null) {
    this.data = data; this.base = base; this.enabled = false;
    this.buffers = new Map(); this.loading = new Map(); this.loops = new Map();
    this.context = null; this.music = null; this.active = false;
    this.animationEvents = animationEvents ? new AnimationAudioEvents(animationEvents) : null;
    this.animationHistory = [];
  }
  async enable(enabled) {
    this.enabled = enabled;
    if (!enabled) { this.stopLoops(); this.music?.pause(); return; }
    this.context ??= new AudioContext();
    await this.context.resume();
    const music = this.data?.bindings.music;
    if (music && !this.music) {
      this.music = new Audio(this.base + this.data.clips[music.clipKey].file);
      this.music.loop = true; this.music.volume = music.minVolume ?? .3;
    }
  }
  async buffer(key) {
    if (this.buffers.has(key)) return this.buffers.get(key);
    if (!this.loading.has(key)) {
      this.loading.set(key, fetch(this.base + this.data.clips[key].file)
        .then(r => { if (!r.ok) throw new Error(`Audio ${r.status}`); return r.arrayBuffer(); })
        .then(b => this.context.decodeAudioData(b)).then(b => { this.buffers.set(key, b); return b; })
        .catch(() => null));
    }
    return this.loading.get(key);
  }
  async play(event, loop = false, allowStopped = false) {
    const binding = this.data?.bindings[event];
    if (!this.enabled || !this.active && !allowStopped || !binding || !this.context) return;
    if (loop && this.loops.has(event)) return;
    const marker = {};
    if (loop) this.loops.set(event, marker);
    const buffer = await this.buffer(binding.clipKey);
    if (!buffer || !this.enabled || !this.active && !allowStopped || loop && this.loops.get(event) !== marker) {
      if (this.loops.get(event) === marker) this.loops.delete(event);
      return;
    }
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer; source.loop = loop;
    const between = (a, b, fallback) => a == null ? fallback : a + Math.random() * ((b ?? a) - a);
    source.playbackRate.value = between(binding.minPitch, binding.maxPitch, 1);
    gain.gain.value = .35 * between(binding.minVolume, binding.maxVolume, 1);
    source.connect(gain).connect(this.context.destination);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    marker.source = source; source.start();
  }
  stopLoops() {
    for (const loop of this.loops.values()) loop.source?.stop();
    this.loops.clear();
  }
  update(state, events) {
    if (this.state !== state) { this.state = state; this.animationEvents?.reset(this.lastAnimationSnapshot); this.animationHistory = []; }
    this.active = state.phase === 'intro' || state.phase === 'running' || state.phase === 'reviving';
    if (!this.enabled) return;
    if (state.phase === 'paused' && this.context?.state === 'running') this.context.suspend();
    else if (state.phase !== 'paused' && this.context?.state === 'suspended') this.context.resume();
    if (this.active && this.music?.paused) this.music.play().catch(() => {});
    else if (!this.active) this.music?.pause();
    const desired = new Set(this.active ? [state.flight && 'jetpackLoop', state.powerups.magnet > 0 && 'magnetLoop'].filter(Boolean) : []);
    for (const [event, loop] of this.loops) if (!desired.has(event)) { loop.source?.stop(); this.loops.delete(event); }
    for (const event of desired) this.play(event, true);
    for (const event of events) {
      // RunnerAnimPlayer installs these on the actual ordinary clip; board
      // keyframe registration is not yet ported and retains its existing cues.
      if (this.animationEvents && !state.board.active && ['jump', 'land', 'roll', 'crash'].includes(event.type)) continue;
      const name = event.type === 'lane' ? `${state.board.active ? 'boardDodge' : 'dodge'}${event.direction < 0 ? 'Left' : 'Right'}`
        : event.type === 'land' ? state.board.active ? 'boardLand' : 'landing'
        : event.type === 'roll' ? state.board.active ? 'boardRoll' : 'roll'
        : event.type === 'board-start' ? 'boardStart'
        : event.type === 'board-hit' ? 'boardCrash'
        : event.type === 'stumble' ? event.animation === 'stumble_low' ? 'stumbleBush' : /left|right/.test(event.animation) ? 'stumbleSide' : 'stumble'
        : event.type === 'start' ? 'runStart'
        : event.type === 'crash' ? event.animation === 'death_moving_train' ? 'hitMovingTrain' : 'bodyFall'
        : event.type;
      // Death one-shots are allowed while the game has just stopped.
      if (event.type === 'crash') this.play(name, false, true);
      else this.play(name);
    }
  }
  updateAnimation(state, snapshot) {
    this.lastAnimationSnapshot = snapshot;
    if (!this.animationEvents) return;
    const cues = this.animationEvents.sample(snapshot, { paused: state.phase === 'paused',
      phase: state.phase, sneakers: state.powerups.sneakers > 0 });
    for (const cue of cues) this.play(cue.binding, false, true);
    this.animationHistory.push(...cues);
    if (this.animationHistory.length > 32) this.animationHistory.splice(0, this.animationHistory.length - 32);
  }
}
