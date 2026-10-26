// Mixed source-derived constructor defaults and browser-specific tuning.
// Native source uses 10 world units per browser unit. Constructor values can be
// overwritten by Unity serialization / XLua and are NOT measured runtime state.
export const DEFAULT_CONFIG = Object.freeze({
  fixedStep: 1 / 120,
  laneSpacing: 2,
  laneChangeSeconds: 0.23,
  initialSpeed: 11,
  maximumSpeed: 22,
  acceleration: 0.055,
  gravity: 20,
  jumpHeight: 2,
  distancePerMeter: 0.8,
  rollSeconds: 0.7,
  playerRadius: 0.32,
  standingHeight: 1.8,
  rollingHeight: 0.65,
  lookAhead: 140,
  removeBehind: 18,
  distanceScore: 3,
  coinScore: 25,
  seed: 48709,
});

export const CONFIG_STATUS = 'provisional-browser-tuning';

export const CONFIG_PROVENANCE = {
  initialSpeed: 'EncryptedSpeedInfo constructor VA 0x11b9dac: min 110 / 10',
  maximumSpeed: 'EncryptedSpeedInfo constructor VA 0x11b9dac: max 220 / 10',
  acceleration: 'Game.Speed VA 0x11baeac: linear min/max interpolation over rampUpDuration=200 seconds',
  laneSpacing: 'Route.GetTrackX VA 0x231529c: trackIndex * 20, centered then scaled / 10',
  laneChangeSeconds: 'CharacterRotationController.DefaultLaneChangeDuration metadata constant 0.23; runtime caller duration may differ',
  laneInterpolation: 'Closure VA 0x22acec0 / coroutine VA 0x22acfc4: linear clamped interpolation, duration proportional to fractional lane distance',
  gravity: 'CharacterBase constructor VA 0x22a2d6c: _gravity 200 / 10',
  jumpHeight: 'CharacterBase constructor VA 0x22a2d6c: jumpHeightNormal 20 / 10',
  jumpVelocity: 'CharacterBase.CalculateJumpVerticalSpeed VA 0x229b348: sqrt(2 * height * gravity)',
  distancePerMeter: 'Game constructor VA 0x11b98ec: distancePerMeter 8 / 10',
  other: 'Browser implementation tuning; not recovered native behavior',
};
