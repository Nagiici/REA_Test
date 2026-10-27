import * as THREE from 'three';

// These identities, blend states and formulas come from the APK's decoded GLES
// programs, not shader-name heuristics. Evidence: analysis/classic/effects-v4.
const MODELS = {
  'c13f3abd6c5e34e40b6e4e449af1645c:1': [0, 5, 10, 0, 0, 15],
  'globalgamemanagers.assets:11': [1, 5, 10, 0, 0, 15],
  'globalgamemanagers.assets:6': [2, 5, 1, 0, 0, 15],
  'globalgamemanagers.assets:5': [3, 5, 10, 0, 0, 14],
  '1c0a7d4aaaeda44edb68fe3c59e84500:1': [4, 5, 10, 0, 0, 14],
  'globalgamemanagers.assets:13': [5, 1, 1, 0, 2, 15],
  'globalgamemanagers.assets:15': [6, 1, 1, 0, 2, 15],
  'globalgamemanagers.assets:21': [7, 5, 10, 0, 2, 15],
  'globalgamemanagers.assets:20': [8, 1, 0, 1, 2, 15],
  'globalgamemanagers.assets:19': [9, 1, 0, 1, 2, 15],
};
const FACTORS = { 0: THREE.ZeroFactor, 1: THREE.OneFactor, 5: THREE.SrcAlphaFactor, 10: THREE.OneMinusSrcAlphaFactor };
const ref = source => `${source.asset}:${source.pathId}`;
const lookup = (items, key) => items instanceof Map ? items.get(key) : items?.[key];
const vector4 = values => new THREE.Vector4().fromArray(values ?? [1, 1, 1, 1]);

const vertexShader = /* glsl */`
attribute vec4 sourceColor;
uniform mat3 sourceUV;
uniform vec4 particleColor;
uniform vec4 tintColor;
uniform vec2 sourceDistortion;
uniform float sourceProjectionSign;
uniform float sourceFogEnabled;
uniform float fogStart;
uniform float fogEnd;
uniform float fogTransitionReciprocal;
uniform float backgroundStart;
uniform float backgroundReciprocal;
varying vec2 sourceVUV;
varying vec4 sourceVColor;
varying vec3 sourceVNormal;
varying vec3 sourceVPosition;
varying vec3 sourceVFog;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  #if SOURCE_MODE != 1 && SOURCE_MODE != 2 && SOURCE_MODE != 3
    // All game transforms have .1 source scale and a reflected Z axis.
    gl_Position.xy += gl_Position.w * gl_Position.w * sourceDistortion * 10.0 * vec2(1.0, sourceProjectionSign);
  #endif
  sourceVUV = (sourceUV * vec3(uv, 1.0)).xy;
  sourceVColor = sourceColor * particleColor;
  #if SOURCE_MODE == 2
    sourceVColor = clamp(sourceVColor, 0.0, 1.0);
  #elif SOURCE_MODE == 3
    sourceVColor *= tintColor;
  #endif
  sourceVNormal = normalMatrix * normal;
  sourceVPosition = view.xyz;
  sourceVFog = vec3(1.0);
  if (sourceFogEnabled > 0.5) {
    float z = (cameraPosition.z - world.z) * 10.0;
    float end = z < 0.0 ? fogEnd + 540.0 : fogEnd;
    sourceVFog.x = clamp((end - abs(z)) * fogTransitionReciprocal, 0.0, 1.0);
    float bg = clamp((backgroundStart - z) * backgroundReciprocal, 0.0, 1.0);
    sourceVFog.y = 1.0 - 1.0 / (1.0 + exp(bg * 12.0 - 6.0));
    float falloff = clamp((-view.z * 10.0 - fogStart) / max(fogEnd - fogStart, 0.00001), 0.0, 1.0);
    sourceVFog.z = 1.0 - falloff * falloff;
  }
}`;

const fragmentShader = /* glsl */`
uniform sampler2D sourceMap;
uniform vec4 tintColor;
uniform vec3 mainColor;
uniform float mainAlpha;
uniform vec3 materialColor;
uniform float materialAlpha;
uniform float colorMultiplier;
uniform vec3 sourceFogColor;
varying vec2 sourceVUV;
varying vec4 sourceVColor;
varying vec3 sourceVNormal;
varying vec3 sourceVPosition;
varying vec3 sourceVFog;
void main() {
  vec4 texel = vec4(1.0);
  #ifdef SOURCE_MAP
    texel = texture2D(sourceMap, sourceVUV);
  #endif
  #if SOURCE_MODE == 0 || SOURCE_MODE == 1 || SOURCE_MODE == 2
    gl_FragColor = texel * sourceVColor;
  #elif SOURCE_MODE == 3
    gl_FragColor = 2.0 * texel * sourceVColor;
    gl_FragColor.a = clamp(gl_FragColor.a, 0.0, 1.0);
  #elif SOURCE_MODE == 4
    vec4 c = 2.0 * texel * sourceVColor * tintColor * colorMultiplier;
    gl_FragColor = vec4(mix(sourceFogColor, c.rgb, sourceVFog.x), c.a * sourceVFog.y);
  #elif SOURCE_MODE == 5
    vec3 c = texel.rgb * colorMultiplier * mainColor;
    vec3 fog = sourceFogColor * dot(c, vec3(0.33));
    gl_FragColor = vec4(mix(fog, c, sourceVFog.x), sourceVFog.y);
  #elif SOURCE_MODE == 6
    gl_FragColor = texel * vec4(mainColor, mainAlpha) * sourceVFog.z;
  #elif SOURCE_MODE == 7
    gl_FragColor = texel;
  #elif SOURCE_MODE == 8
    gl_FragColor = vec4(mix(sourceFogColor, texel.rgb * materialColor, sourceVFog.x), sourceVFog.y);
  #elif SOURCE_MODE == 9
    float rim = pow(1.0 - clamp(-dot(normalize(sourceVNormal), normalize(sourceVPosition)), 0.0, 1.0), 2.75) * 1.5;
    rim *= clamp(dot(texel.rgb, vec3(0.33)), 0.0, 0.33);
    gl_FragColor = texel * vec4(materialColor, materialAlpha) + vec4(rim);
  #endif
  // Original PlayerSettings.m_ActiveColorSpace = 0 (Gamma). Textures and
  // shader numeric colors stay in that domain; no extra sRGB encoding or ACES.
}`;

class SourceEffectMaterial extends THREE.ShaderMaterial {
  get color() { return this.uniforms[this.userData.colorUniform ?? 'materialColor']?.value; }
  get map() { return this.uniforms.sourceMap?.value ?? null; }
  onBeforeRender() {
    if (this.map) { this.map.updateMatrix(); this.uniforms.sourceUV.value.copy(this.map.matrix); }
  }
  copy(source) {
    super.copy(source);
    // ShaderMaterial.clone clones texture handles unnecessarily for every
    // particle. A single emitter owns its map; particles only vary uniforms.
    if (this.uniforms.sourceMap) this.uniforms.sourceMap.value = source.map;
    this.userData.ownsSourceMap = false;
    return this;
  }
}

/** Recovered source shader, including exact alpha factors and source tint use.
 * color.setScalar() drives the source _MainColor of coin/powerup flashes;
 * map.offset/repeat retain the source jetpack scrolling contract.
 * Optional globals must be provided consistently with the whole scene:
 * {distortion:[x,y], projectionSign, fog:{color,start,end,transitionReciprocal,
 * backgroundStart,backgroundReciprocal}}; source distances use original units.
 */
export function createSourceEffectMaterial(record, pack, { globals = {}, particleColor = [1, 1, 1, 1] } = {}) {
  const shaderRef = ref(record.shader.source), model = MODELS[shaderRef];
  if (!model) throw new Error(`Source effect shader ${shaderRef} has no recovered browser implementation`);
  const [mode, src, dst, zWrite, cull, mask] = model;
  const presentation = pack.presentation ?? pack.classicPresentation;
  const evidence = presentation?.materialShaders?.[shaderRef];
  if (evidence && (evidence.state.srcBlend !== src || evidence.state.destBlend !== dst)) throw new Error(`Shader state differs from verified ${shaderRef}`);
  const info = record.textures?._MainTex;
  let map = info ? lookup(pack.textures, info.name) : null;
  if (info && !map) throw new Error(`Source texture ${info.name} has not been loaded`);
  if (map) {
    map = map.clone(); map.repeat.fromArray(info.scale ?? [1, 1]); map.offset.fromArray(info.offset ?? [0, 0]);
    map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true;
  }
  const colors = record.colors ?? {}, main = colors._MainColor ?? [1, 1, 1, 1], color = colors._Color ?? [1, 1, 1, 1];
  const fog = globals.fog;
  const material = new SourceEffectMaterial({ name: record.name, vertexShader, fragmentShader,
    defines: { SOURCE_MODE: mode, ...(map ? { SOURCE_MAP: 1 } : {}) },
    uniforms: {
      sourceMap: { value: map }, sourceUV: { value: new THREE.Matrix3() }, particleColor: { value: vector4(particleColor) },
      tintColor: { value: vector4(colors._TintColor) }, mainColor: { value: new THREE.Color().fromArray(main) }, mainAlpha: { value: main[3] },
      materialColor: { value: new THREE.Color().fromArray(color) }, materialAlpha: { value: color[3] },
      colorMultiplier: { value: record.floats?._ColorMultiplier ?? 1 },
      sourceDistortion: { value: new THREE.Vector2().fromArray(globals.distortion ?? [0, 0]) }, sourceProjectionSign: { value: globals.projectionSign ?? 1 },
      sourceFogEnabled: { value: fog ? 1 : 0 }, sourceFogColor: { value: new THREE.Color().fromArray(fog?.color ?? [0, 0, 0]) },
      fogStart: { value: fog?.start ?? 0 }, fogEnd: { value: fog?.end ?? 1 }, fogTransitionReciprocal: { value: fog?.transitionReciprocal ?? 1 },
      backgroundStart: { value: fog?.backgroundStart ?? 0 }, backgroundReciprocal: { value: fog?.backgroundReciprocal ?? 1 },
    },
    transparent: dst !== 0, depthWrite: !!zWrite, depthTest: true, depthFunc: THREE.LessEqualDepth,
    side: cull === 0 ? THREE.DoubleSide : cull === 1 ? THREE.BackSide : THREE.FrontSide,
    toneMapped: false, blending: dst === 0 ? THREE.NoBlending : THREE.CustomBlending,
    blendSrc: FACTORS[src], blendDst: FACTORS[dst], blendEquation: THREE.AddEquation,
    // ColorMask RGB in the two Alpha Blended shaders leaves destination alpha intact.
    blendSrcAlpha: mask === 14 ? THREE.ZeroFactor : FACTORS[src], blendDstAlpha: mask === 14 ? THREE.OneFactor : FACTORS[dst],
    blendEquationAlpha: THREE.AddEquation,
  });
  material.defaultAttributeValues.sourceColor = [1, 1, 1, 1];
  material.userData = { shaderRef, sourceShader: record.shader.name, sourceState: { src, dst, zWrite, cull, mask },
    colorUniform: [5, 6].includes(mode) ? 'mainColor' : 'materialColor', ownsSourceMap: !!map,
    limitations: ['Full scene distortion/fog globals are opt-in; disabled unless supplied consistently with other world geometry.',
      'Soft-particle depth intersection variant is not enabled; source default GLES program is used.'] };
  material.onBeforeRender();
  return material;
}

export function setSourceParticleColor(material, rgba) {
  material.uniforms.particleColor.value.fromArray(rgba);
}

export function disposeSourceEffectMaterial(material) {
  if (material.userData.ownsSourceMap) material.map?.dispose();
  material.dispose();
}
