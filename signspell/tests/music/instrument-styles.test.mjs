import assert from 'node:assert/strict';
import test from 'node:test';

import { VIBE_COLLECTIONS } from '../../js/music/collections.js';
import { listInstrumentStyles, resolveInstrumentStyle } from '../../js/music/instrument-styles.js';

test('every collection instrument resolves to its own explicit sound profile', () => {
  for (const collection of Object.values(VIBE_COLLECTIONS)) {
    for (const [instrument, presetId] of Object.entries(collection.instruments)) {
      assert.equal(
        resolveInstrumentStyle(instrument, presetId).id,
        presetId,
        `${collection.id}/${instrument} fell through to a generic style`,
      );
    }
  }
});

test('all vibe collections have distinct profiles in every instrument family', () => {
  for (const instrument of Object.keys(Object.values(VIBE_COLLECTIONS)[0].instruments)) {
    const profiles = Object.values(VIBE_COLLECTIONS).map((collection) => (
      resolveInstrumentStyle(instrument, collection.instruments[instrument])
    ));
    assert.equal(new Set(profiles.map((profile) => JSON.stringify(profile))).size, profiles.length, instrument);
    assert.equal(listInstrumentStyles(instrument).length, profiles.length, `${instrument} has missing or orphaned styles`);
  }
});

test('representative acoustic and electronic presets change meaningful timbre controls', () => {
  assert.notEqual(resolveInstrumentStyle('piano', 'feltTape').cutoff, resolveInstrumentStyle('piano', 'warpedKeys').cutoff);
  assert.notEqual(resolveInstrumentStyle('steelGuitar', 'oldBronze').feedback, resolveInstrumentStyle('steelGuitar', 'tapeTwelve').feedback);
  assert.notEqual(resolveInstrumentStyle('violin', 'softRosin').vibratoDepth, resolveInstrumentStyle('violin', 'razorBow').vibratoDepth);
  assert.notDeepEqual(resolveInstrumentStyle('organ', 'bedroomReed').drawbars, resolveInstrumentStyle('organ', 'smallChurch').drawbars);
  assert.notEqual(resolveInstrumentStyle('drumKit', 'brushKit').metalQ, resolveInstrumentStyle('drumKit', 'ironKit').metalQ);
  assert.ok(resolveInstrumentStyle('overdrivenGuitar', 'toxicAmp').drive > resolveInstrumentStyle('overdrivenGuitar', 'chamberAmp').drive);
  assert.ok(resolveInstrumentStyle('overdrivenBass', 'elasticBass').cutoff > resolveInstrumentStyle('overdrivenBass', 'furnaceBass').cutoff);
});
