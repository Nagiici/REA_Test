import { createSourceParticleEffect } from './source-particles.js';

/** Source KeyframeBehaviour events are indexed in the complete serialized list,
 * and use KeyFrame / AnimationClip.frameRate. No sprite, face or backpack state
 * is inferred from the animation name. */
export class SourceIntroProps {
  constructor(source, { clipName = 'idlePaint' } = {}) {
    this.source = source;
    this.clipName = clipName;
    this.clip = source.menuClips?.[clipName];
    if (!this.clip || !(this.clip.duration > 0)) throw new Error(`Missing source menu events for ${clipName}`);
    this.actions = [...this.clip.actions].sort((a, b) => a.time - b.time || a.index - b.index);
    if (this.actions.some(a => !Number.isFinite(a.time) || a.time < 0 || a.time > this.clip.duration)) throw new Error('Invalid source keyframe time');
    this.reset();
  }
  reset() {
    this.phase = null; this.elapsed = 0; this.emitting = false;
    return this.sample();
  }
  sample() {
    return { phase: this.phase, clipName: this.clipName, elapsed: this.elapsed,
      clipTime: this.elapsed % this.clip.duration, sprayVisible: this.phase === 'ready',
      sprayEmitting: this.phase === 'ready' && this.emitting,
      eyeAnimationRequested: this.phase === 'ready', eyeMode: 0 };
  }
  step(dt, { phase, paused = false } = {}) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Intro prop dt must be finite and nonnegative');
    if (paused || phase === 'paused') return { ...this.sample(), events: [], segments: [] };
    const events = [], segments = [];
    if (phase !== this.phase) {
      const before = this.phase; this.phase = phase;
      const ready = phase === 'ready';
      if (ready) { this.elapsed = 0; this.emitting = Boolean(this.source.spray.playOnAwake); }
      else this.emitting = false;
      events.push({ type: 'spray-visible', enabled: ready, at: 0 },
        { type: 'eye-animation-request', enabled: ready, mode: 0, at: 0 },
        { type: 'spray-emission', enabled: this.emitting, at: 0, reason: ready ? 'play-on-awake-adapter' : 'source-intro-hide' });
      if (before === 'ready' && !ready) events.push({ type: 'clear-hidden-spray', at: 0 });
    }
    if (phase !== 'ready') return { ...this.sample(), events, segments };
    const start = this.elapsed, end = start + dt, duration = this.clip.duration;
    let cursor = start;
    const firstLoop = Math.floor(start / duration), lastLoop = Math.floor(end / duration);
    for (let loop = firstLoop; loop <= lastLoop; loop++) for (const action of this.actions) {
      const time = loop * duration + action.time;
      if (!(time > start && time <= end)) continue;
      if (time > cursor) segments.push({ duration: time - cursor, emitting: this.emitting });
      cursor = time; this.emitting = action.enabled;
      events.push({ type: 'spray-emission', enabled: action.enabled, at: time - start,
        loop, time, frame: action.frame, actionIndex: action.index, reason: 'source-keyframe' });
    }
    if (end > cursor) segments.push({ duration: end - cursor, emitting: this.emitting });
    this.elapsed = end;
    return { ...this.sample(), events, segments };
  }
}

/** Attach both visible can and source particle graph as SIBLINGS at the hand.
 * Each graph already includes Mesh -> three emitter descendant transforms.
 * The canonical .1/.1/-.1 native conversion is retained; bodyFitScale=.8 gives
 * .08/.08/-.08. That fit is a replacement-avatar adapter, not a source constant.
 * pack.introProps is the JSON named by manifest.classicIntroProps.
 * eyeAdapter is optional and must only target a verified compatible eye rig.
 */
export function createClassicIntroProps(pack, {
  character, attachment = character?.native?.getObjectByName('R_Hand_jnt'),
  spray = null, bodyFitScale = .8, eyeAdapter = null, random,
} = {}) {
  const source = pack.introProps ?? pack.classicIntroProps;
  if (!source?.presentation) throw new Error('Missing recovered classic intro props');
  if (!attachment) throw new Error('Replacement character has no verified right-hand attachment');
  if (!(bodyFitScale > 0) || !Number.isFinite(bodyFitScale)) throw new RangeError('Invalid replacement hand fit');
  const can = spray ?? pack.clonePrefab(source.spray.prefabKey);
  if (!can) throw new Error(`Missing source spray prefab ${source.spray.prefabKey}`);
  // A later shader analysis can enrich the shared presentation after this
  // self-contained source export. Keep those verified shader definitions.
  const presentation = { ...source.presentation, materialShaders: {
    ...pack.classicPresentation?.materialShaders, ...pack.presentation?.materialShaders,
    ...source.presentation.materialShaders,
  } };
  const particles = createSourceParticleEffect(source.spray.effectKey,
    { ...pack, presentation }, { random });
  can.scale.multiplyScalar(bodyFitScale); particles.object.scale.multiplyScalar(bodyFitScale);
  attachment.add(can, particles.object);
  can.visible = particles.object.visible = false;
  const timeline = new SourceIntroProps(source);
  return {
    can, particles, timeline,
    limitations: [...source.limitations, ...particles.limitations,
      ...(eyeAdapter ? [] : ['Source eye requests are recorded only; replacement facial rig is unchanged.'])],
    update(dt, { phase, paused = false, camera } = {}) {
      const sample = timeline.step(dt, { phase, paused });
      if (paused || phase === 'paused') return sample;
      for (const event of sample.events) {
        if (event.type === 'spray-visible') can.visible = particles.object.visible = event.enabled;
        if (event.type === 'eye-animation-request' && eyeAdapter) eyeAdapter(event);
        if (event.type === 'clear-hidden-spray') particles.reset();
      }
      for (const segment of sample.segments) {
        if (segment.emitting) particles.play(); else particles.stop();
        particles.update(segment.duration, { camera });
      }
      if (sample.sprayEmitting) particles.play(); else particles.stop();
      particles.object.visible = sample.sprayVisible;
      return sample;
    },
    reset() { timeline.reset(); particles.reset(); can.visible = particles.object.visible = false; },
    dispose() { particles.dispose(); can.removeFromParent(); },
  };
}
