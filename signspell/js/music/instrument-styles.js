const freezeProfiles = (profiles) => Object.freeze(Object.fromEntries(
  Object.entries(profiles).map(([id, profile]) => [id, Object.freeze({ id, ...profile })]),
));

// Original, sample-free sound identities. These profiles are deliberately
// shared by realtime gates, sequenced playback and OfflineAudioContext export.
const STYLES = Object.freeze({
  '808': freezeProfiles({
    warmWound: { wave: 'sine', overtoneWave: 'triangle', overtoneMix: 0.045, drive: 42, cutoff: 190, resonance: 0.65, pitchDrop: 1.38, pitchTime: 0.105, hold: 0.78, release: 0.5, level: 0.47 },
    tapeGrave: { wave: 'sine', overtoneWave: 'square', overtoneMix: 0.035, drive: 72, cutoff: 245, resonance: 1.8, pitchDrop: 1.62, pitchTime: 0.14, hold: 0.62, release: 0.62, level: 0.49 },
    redline: { wave: 'sine', overtoneWave: 'sawtooth', overtoneMix: 0.065, drive: 104, cutoff: 330, resonance: 0.9, pitchDrop: 1.82, pitchTime: 0.055, hold: 0.48, release: 0.34, level: 0.5 },
    ironLung: { wave: 'triangle', overtoneWave: 'square', overtoneMix: 0.07, drive: 128, cutoff: 175, resonance: 2.4, pitchDrop: 1.94, pitchTime: 0.09, hold: 0.86, release: 0.68, level: 0.45 },
    chamberSub: { wave: 'sine', overtoneWave: 'sine', overtoneMix: 0.025, drive: 18, cutoff: 155, resonance: 0.4, pitchDrop: 1.24, pitchTime: 0.12, hold: 0.68, release: 0.42, level: 0.43 },
    sunsetSub: { wave: 'sine', overtoneWave: 'triangle', overtoneMix: 0.09, drive: 36, cutoff: 285, resonance: 1.15, pitchDrop: 1.48, pitchTime: 0.075, hold: 0.73, release: 0.54, level: 0.46 },
    voltageSub: { wave: 'triangle', overtoneWave: 'sawtooth', overtoneMix: 0.08, drive: 88, cutoff: 225, resonance: 1.6, pitchDrop: 1.7, pitchTime: 0.045, hold: 0.42, release: 0.38, level: 0.48 },
  }),
  bass: freezeProfiles({
    softPickBass: { waveA: 'triangle', waveB: 'sawtooth', ratioB: 2, mixB: 0.12, detune: 1.5, cutoff: 900, resonance: 0.8, drive: 14, attack: 0.009, sustain: 0.22, release: 0.62 },
    gravePickBass: { waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, mixB: 0.1, detune: 3, cutoff: 570, resonance: 1.9, drive: 38, attack: 0.004, sustain: 0.16, release: 0.8 },
    overdriveBass: { waveA: 'sawtooth', waveB: 'square', ratioB: 2, mixB: 0.2, detune: 5, cutoff: 1320, resonance: 0.7, drive: 66, attack: 0.003, sustain: 0.12, release: 0.42 },
    fuzzBass: { waveA: 'square', waveB: 'sawtooth', ratioB: 1, mixB: 0.24, detune: 11, cutoff: 510, resonance: 2.5, drive: 92, attack: 0.012, sustain: 0.18, release: 0.66 },
    uprightShadow: { waveA: 'triangle', waveB: 'sine', ratioB: 2, mixB: 0.065, detune: 0.8, cutoff: 690, resonance: 1.35, drive: 8, attack: 0.016, sustain: 0.3, release: 0.92 },
    sunsetCompressor: { waveA: 'sawtooth', waveB: 'triangle', ratioB: 1, mixB: 0.18, detune: 7, cutoff: 1480, resonance: 1.55, drive: 29, attack: 0.011, sustain: 0.26, release: 0.74 },
    voltageBass: { waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, mixB: 0.16, detune: 2.5, cutoff: 980, resonance: 1.2, drive: 54, attack: 0.002, sustain: 0.1, release: 0.34 },
  }),
  eerieLead: freezeProfiles({
    velvetChorus: { waveA: 'triangle', waveB: 'sawtooth', cents: 9, cutoff: 2050, resonance: 1.1, attack: 0.024, release: 0.78, mixB: 0.32, vibratoRate: 4.2, vibratoDepth: 3.5 },
    neonCrypt: { waveA: 'sawtooth', waveB: 'triangle', cents: 13, cutoff: 1320, resonance: 3.4, attack: 0.008, release: 0.58, mixB: 0.24, vibratoRate: 6.1, vibratoDepth: 7 },
    nightDrive: { waveA: 'sawtooth', waveB: 'square', cents: 5, cutoff: 2850, resonance: 0.7, attack: 0.004, release: 0.36, mixB: 0.17, vibratoRate: 5.4, vibratoDepth: 2 },
    blackGlass: { waveA: 'sawtooth', waveB: 'sawtooth', cents: 17, cutoff: 840, resonance: 4.6, attack: 0.032, release: 0.9, mixB: 0.46, vibratoRate: 3.2, vibratoDepth: 9 },
    whistleGlass: { waveA: 'triangle', waveB: 'sine', cents: 4, cutoff: 3650, resonance: 5.2, attack: 0.045, release: 1.05, mixB: 0.2, vibratoRate: 5.9, vibratoDepth: 12 },
    liquidPhase: { waveA: 'sawtooth', waveB: 'triangle', cents: 19, cutoff: 1720, resonance: 2.2, attack: 0.038, release: 0.96, mixB: 0.42, vibratoRate: 0.72, vibratoDepth: 16 },
    staticChoir: { waveA: 'square', waveB: 'sawtooth', cents: 7, cutoff: 1180, resonance: 3.8, attack: 0.012, release: 0.52, mixB: 0.34, vibratoRate: 7.1, vibratoDepth: 5 },
  }),
  organ: freezeProfiles({
    bedroomReed: { drawbars: [0.82, 1, 0.28, 0.1, 0.04], cutoff: 2150, resonance: 0.7, attack: 0.03, release: 0.5, tremoloRate: 3.4, tremoloDepth: 0.035 },
    funeralPipes: { drawbars: [1, 0.74, 0.5, 0.3, 0.2], cutoff: 2380, resonance: 1.4, attack: 0.08, release: 0.9, tremoloRate: 2.1, tremoloDepth: 0.025 },
    smallChurch: { drawbars: [1, 0.48, 0.25, 0.12, 0.06], cutoff: 3150, resonance: 0.45, attack: 0.012, release: 0.34, tremoloRate: 5.2, tremoloDepth: 0.02 },
    ironDrawbar: { drawbars: [1, 0.4, 0.72, 0.36, 0.28], cutoff: 1480, resonance: 2.8, attack: 0.025, release: 0.58, tremoloRate: 6.4, tremoloDepth: 0.055 },
    reedChamber: { drawbars: [0.5, 1, 0.3, 0.1, 0.035], cutoff: 1850, resonance: 3.3, attack: 0.055, release: 0.72, tremoloRate: 4.7, tremoloDepth: 0.018 },
    rotarySun: { drawbars: [0.88, 1, 0.6, 0.25, 0.15], cutoff: 2700, resonance: 0.9, attack: 0.02, release: 0.64, tremoloRate: 6.8, tremoloDepth: 0.09 },
    valveRitual: { drawbars: [1, 0.3, 0.82, 0.46, 0.34], cutoff: 1720, resonance: 2.1, attack: 0.009, release: 0.4, tremoloRate: 7.6, tremoloDepth: 0.045 },
  }),
  steelGuitar: freezeProfiles({
    oldBronze: { brightness: 0.78, damping: 4050, feedback: 0.978, bodyRatio: 4.2, bodyQ: 0.9, pickNoise: 0.045, detune: 1.8, release: 1.9 },
    graveWire: { brightness: 0.56, damping: 2750, feedback: 0.974, bodyRatio: 3.4, bodyQ: 2.2, pickNoise: 0.03, detune: 3.2, release: 2.2 },
    brightScar: { brightness: 1.18, damping: 5700, feedback: 0.981, bodyRatio: 5.4, bodyQ: 0.55, pickNoise: 0.075, detune: 0.9, release: 1.35 },
    rustString: { brightness: 0.48, damping: 2300, feedback: 0.969, bodyRatio: 2.8, bodyQ: 3.1, pickNoise: 0.065, detune: 5.5, release: 1.55 },
    clockworkPluck: { brightness: 0.92, damping: 4600, feedback: 0.958, bodyRatio: 6.2, bodyQ: 1.6, pickNoise: 0.025, detune: 0.5, release: 0.8 },
    tapeTwelve: { brightness: 0.88, damping: 4250, feedback: 0.983, bodyRatio: 4.8, bodyQ: 0.7, pickNoise: 0.055, detune: 7.2, release: 2.35 },
    detunedWire: { brightness: 0.96, damping: 3300, feedback: 0.965, bodyRatio: 3.1, bodyQ: 2.6, pickNoise: 0.085, detune: 13, release: 1.05 },
  }),
  overdrivenGuitar: freezeProfiles({
    frayedAmp: { waveA: 'sawtooth', waveB: 'triangle', detune: 8, drive: 52, highpass: 95, cutoff: 3300, resonance: 0.8, attack: 0.004, sustain: 0.34, release: 0.62, level: 0.2 },
    graveAmp: { waveA: 'sawtooth', waveB: 'square', detune: 12, drive: 76, highpass: 110, cutoff: 2100, resonance: 1.8, attack: 0.006, sustain: 0.3, release: 0.78, level: 0.19 },
    clippedAmp: { waveA: 'square', waveB: 'sawtooth', detune: 4, drive: 92, highpass: 125, cutoff: 4100, resonance: 0.55, attack: 0.002, sustain: 0.18, release: 0.32, level: 0.21 },
    slagAmp: { waveA: 'square', waveB: 'square', detune: 17, drive: 118, highpass: 105, cutoff: 1650, resonance: 2.6, attack: 0.008, sustain: 0.42, release: 0.7, level: 0.18 },
    chamberAmp: { waveA: 'triangle', waveB: 'sawtooth', detune: 3, drive: 34, highpass: 130, cutoff: 3600, resonance: 1.1, attack: 0.003, sustain: 0.2, release: 0.46, level: 0.18 },
    sunFuzz: { waveA: 'sawtooth', waveB: 'triangle', detune: 21, drive: 68, highpass: 85, cutoff: 2800, resonance: 1.4, attack: 0.01, sustain: 0.48, release: 0.92, level: 0.19 },
    toxicAmp: { waveA: 'square', waveB: 'sawtooth', detune: 6, drive: 104, highpass: 115, cutoff: 2450, resonance: 1.7, attack: 0.0015, sustain: 0.11, release: 0.24, level: 0.22 },
  }),
  overdrivenBass: freezeProfiles({
    bruisedDriveBass: { waveA: 'triangle', waveB: 'sawtooth', ratioB: 2, mixB: 0.14, detune: 2, cutoff: 920, resonance: 0.8, drive: 32, attack: 0.006, sustain: 0.28, release: 0.62, level: 0.27 },
    cryptDriveBass: { waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, mixB: 0.12, detune: 5, cutoff: 620, resonance: 1.9, drive: 58, attack: 0.004, sustain: 0.22, release: 0.74, level: 0.27 },
    redlineDriveBass: { waveA: 'square', waveB: 'sawtooth', ratioB: 2, mixB: 0.2, detune: 3, cutoff: 1450, resonance: 0.7, drive: 74, attack: 0.002, sustain: 0.12, release: 0.34, level: 0.29 },
    furnaceBass: { waveA: 'square', waveB: 'square', ratioB: 1, mixB: 0.24, detune: 9, cutoff: 520, resonance: 2.8, drive: 98, attack: 0.008, sustain: 0.3, release: 0.68, level: 0.25 },
    uprightDrive: { waveA: 'triangle', waveB: 'sine', ratioB: 2, mixB: 0.08, detune: 1, cutoff: 760, resonance: 1.3, drive: 24, attack: 0.014, sustain: 0.36, release: 0.86, level: 0.26 },
    liquidDriveBass: { waveA: 'sawtooth', waveB: 'triangle', ratioB: 1, mixB: 0.18, detune: 11, cutoff: 1320, resonance: 1.6, drive: 44, attack: 0.01, sustain: 0.32, release: 0.8, level: 0.27 },
    elasticBass: { waveA: 'sawtooth', waveB: 'square', ratioB: 0.5, mixB: 0.17, detune: 2, cutoff: 1120, resonance: 1.35, drive: 70, attack: 0.0015, sustain: 0.09, release: 0.3, level: 0.3 },
  }),
  violin: freezeProfiles({
    softRosin: { cutoff: 2550, resonance: 1.1, attack: 0.13, release: 0.72, detuneA: -2, detuneB: 3, vibratoRate: 5.1, vibratoDepth: 5 },
    cryptRosin: { cutoff: 1680, resonance: 2.4, attack: 0.19, release: 1.0, detuneA: -5, detuneB: 6, vibratoRate: 4.4, vibratoDepth: 8 },
    closeBow: { cutoff: 3300, resonance: 0.65, attack: 0.055, release: 0.42, detuneA: -1, detuneB: 2, vibratoRate: 5.8, vibratoDepth: 3 },
    razorBow: { cutoff: 1900, resonance: 4.2, attack: 0.075, release: 0.54, detuneA: -7, detuneB: 9, vibratoRate: 6.6, vibratoDepth: 11 },
    loopedBow: { cutoff: 2350, resonance: 1.7, attack: 0.22, release: 1.25, detuneA: -3, detuneB: 4, vibratoRate: 5.3, vibratoDepth: 7 },
    mellotronBow: { cutoff: 1420, resonance: 0.8, attack: 0.16, release: 1.4, detuneA: -9, detuneB: 8, vibratoRate: 3.6, vibratoDepth: 14 },
    feverBow: { cutoff: 2250, resonance: 3.1, attack: 0.045, release: 0.46, detuneA: -6, detuneB: 7, vibratoRate: 7.3, vibratoDepth: 10 },
  }),
  piano: freezeProfiles({
    feltTape: { ratios: [1, 2.005, 3.01], levels: [1, 0.32, 0.14], attack: 0.006, hold: 0.055, release: 1.35, cutoff: 2450, detune: 2.5 },
    cryptKeys: { ratios: [1, 1.997, 4.02], levels: [1, 0.24, 0.18], attack: 0.003, hold: 0.035, release: 1.65, cutoff: 1650, detune: 7 },
    bareFelt: { ratios: [1, 2.01, 3.02], levels: [1, 0.42, 0.2], attack: 0.002, hold: 0.025, release: 0.72, cutoff: 3900, detune: 0.8 },
    brokenOrgan: { ratios: [0.5, 1, 2.015], levels: [0.48, 1, 0.36], attack: 0.018, hold: 0.09, release: 1.1, cutoff: 1150, detune: 12 },
    woodRoom: { ratios: [1, 2.003, 3.98], levels: [1, 0.2, 0.09], attack: 0.004, hold: 0.045, release: 0.92, cutoff: 2850, detune: 1.2 },
    warpedKeys: { ratios: [1, 2.018, 3.03], levels: [1, 0.35, 0.12], attack: 0.009, hold: 0.07, release: 1.55, cutoff: 2050, detune: 15 },
    hammerKeys: { ratios: [1, 2.014, 4.01], levels: [1, 0.46, 0.22], attack: 0.0015, hold: 0.018, release: 0.62, cutoff: 3150, detune: 4 },
  }),
  percussion: freezeProfiles({
    softRust: { brightness: 0.68, decay: 0.72, level: 0.72, bodyPitch: 176, bodyLevel: 0.07, metalQ: 8 },
    vhsMetal: { brightness: 1.12, decay: 1.24, level: 0.96, bodyPitch: 151, bodyLevel: 0.11, metalQ: 15 },
    impact: { brightness: 1.28, decay: 0.82, level: 1.08, bodyPitch: 214, bodyLevel: 0.15, metalQ: 11 },
    ironDust: { brightness: 0.76, decay: 1.34, level: 1.12, bodyPitch: 122, bodyLevel: 0.17, metalQ: 18 },
    handMachine: { brightness: 0.54, decay: 0.88, level: 0.66, bodyPitch: 238, bodyLevel: 0.055, metalQ: 6 },
    tapeDust: { brightness: 0.82, decay: 1.08, level: 0.82, bodyPitch: 184, bodyLevel: 0.09, metalQ: 10 },
    boltDust: { brightness: 1.18, decay: 0.72, level: 1.15, bodyPitch: 132, bodyLevel: 0.18, metalQ: 17 },
  }),
  drumKit: freezeProfiles({
    bedroomKit: { brightness: 0.74, decay: 0.78, level: 0.78, bodyPitch: 178, bodyLevel: 0.08, metalQ: 7, kickStart: 118, kickEnd: 50, kickPitchTime: 0.058, kickRelease: 0.32, kickLevel: 0.52 },
    cemeteryKit: { brightness: 1.05, decay: 1.2, level: 1, bodyPitch: 156, bodyLevel: 0.13, metalQ: 16, kickStart: 164, kickEnd: 43, kickPitchTime: 0.092, kickRelease: 0.46, kickLevel: 0.68 },
    redlineKit: { brightness: 1.22, decay: 0.88, level: 1.12, bodyPitch: 208, bodyLevel: 0.17, metalQ: 10, kickStart: 184, kickEnd: 47, kickPitchTime: 0.052, kickRelease: 0.27, kickLevel: 0.74 },
    ironKit: { brightness: 0.7, decay: 1.32, level: 1.16, bodyPitch: 118, bodyLevel: 0.19, metalQ: 19, kickStart: 138, kickEnd: 40, kickPitchTime: 0.102, kickRelease: 0.5, kickLevel: 0.78 },
    brushKit: { brightness: 0.48, decay: 1.46, level: 0.62, bodyPitch: 226, bodyLevel: 0.045, metalQ: 5, kickStart: 88, kickEnd: 55, kickPitchTime: 0.045, kickRelease: 0.23, kickLevel: 0.39 },
    sunroomKit: { brightness: 0.86, decay: 1.12, level: 0.88, bodyPitch: 166, bodyLevel: 0.1, metalQ: 9, kickStart: 108, kickEnd: 51, kickPitchTime: 0.074, kickRelease: 0.38, kickLevel: 0.59 },
    voltageKit: { brightness: 1.14, decay: 0.7, level: 1.18, bodyPitch: 204, bodyLevel: 0.19, metalQ: 14, kickStart: 192, kickEnd: 46, kickPitchTime: 0.044, kickRelease: 0.25, kickLevel: 0.76 },
  }),
  pad: freezeProfiles({
    sleepingHall: { waves: ['sine', 'triangle', 'sine'], cutoff: 760, resonance: 0.8, attack: 0.34, release: 1.25, detune: 5 },
    choirDust: { waves: ['triangle', 'sawtooth', 'sine'], cutoff: 610, resonance: 2.2, attack: 0.52, release: 1.65, detune: 11 },
    roomTone: { waves: ['sine', 'triangle', 'triangle'], cutoff: 980, resonance: 0.5, attack: 0.18, release: 0.76, detune: 2 },
    coldChapel: { waves: ['sawtooth', 'triangle', 'sawtooth'], cutoff: 490, resonance: 4.2, attack: 0.46, release: 1.4, detune: 17 },
    chamberAir: { waves: ['sine', 'sine', 'triangle'], cutoff: 1220, resonance: 1.8, attack: 0.62, release: 1.9, detune: 3 },
    analogCloud: { waves: ['sawtooth', 'triangle', 'sine'], cutoff: 880, resonance: 1.15, attack: 0.28, release: 1.75, detune: 14 },
    blackoutPad: { waves: ['square', 'sawtooth', 'triangle'], cutoff: 560, resonance: 3.4, attack: 0.16, release: 0.88, detune: 9 },
  }),
});

const DEFAULT_IDS = Object.freeze({
  '808': 'warmWound', bass: 'softPickBass', eerieLead: 'velvetChorus', organ: 'bedroomReed',
  steelGuitar: 'oldBronze', overdrivenGuitar: 'frayedAmp', overdrivenBass: 'bruisedDriveBass', violin: 'softRosin', piano: 'feltTape', percussion: 'softRust',
  drumKit: 'bedroomKit', pad: 'sleepingHall',
});

export function resolveInstrumentStyle(instrument, presetId = null) {
  const family = STYLES[instrument];
  if (!family) throw new RangeError(`Unknown instrument style family: ${instrument}`);
  return family[presetId] || family[DEFAULT_IDS[instrument]];
}

export function listInstrumentStyles(instrument) {
  const family = STYLES[instrument];
  if (!family) throw new RangeError(`Unknown instrument style family: ${instrument}`);
  return Object.values(family);
}

export const INSTRUMENT_STYLE_PROFILES = STYLES;
