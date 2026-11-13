import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings } from './settings';

describe('app settings', () => {
  it('loads defaults from nothing, bad JSON or a wrong shape', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.piano.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.controller.padNotes).toHaveLength(8);
  });

  it('keeps good groups when another group is damaged', () => {
    const text = JSON.stringify({
      piano: { enabled: true, volume: 0.3, sound: 'grand' },
      controller: { padChannel: 99 },
    });
    const s = parseSettings(text);
    expect(s.piano.enabled).toBe(true);
    expect(s.piano.sound).toBe('grand');
    expect(s.controller).toEqual(DEFAULT_SETTINGS.controller);
  });

  it('merges a patch group by group and refuses invalid results', () => {
    const on = mergeSettings(DEFAULT_SETTINGS, { piano: { enabled: true } });
    expect(on.piano.enabled).toBe(true);
    expect(on.piano.volume).toBe(DEFAULT_SETTINGS.piano.volume);
    expect(on.keysOverlay).toEqual(DEFAULT_SETTINGS.keysOverlay);
    const bad = mergeSettings(on, { controller: { knobCCs: [1, 2] } });
    expect(bad).toBe(on);
  });
});
