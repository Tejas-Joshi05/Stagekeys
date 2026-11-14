import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, SettingsPatchSchema } from './settings';

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

  it('a patch carries only what was changed, never defaults for the rest', () => {
    // Main validates every patch with this schema before merging it. If validation
    // filled in defaults, toggling the piano would reset its volume and sound.
    const toggle = SettingsPatchSchema.parse({ piano: { enabled: true } });
    expect(toggle).toEqual({ piano: { enabled: true } });
    const custom = mergeSettings(DEFAULT_SETTINGS, {
      piano: { volume: 0.2, sound: 'grand' },
      keysOverlay: { corner: 'top-left' },
      audioInput: { enabled: true },
    });
    const after = mergeSettings(
      custom,
      SettingsPatchSchema.parse({
        piano: { enabled: true },
        keysOverlay: { stage: true },
        audioInput: { sensitivity: 1 },
      }),
    );
    expect(after.piano).toEqual({ ...custom.piano, enabled: true });
    expect(after.keysOverlay).toEqual({ ...custom.keysOverlay, stage: true });
    expect(after.audioInput).toEqual({ enabled: true, sensitivity: 1, deviceId: '' });
    expect(after.controller).toEqual(custom.controller);
  });

  it('refuses patches with wrong values or unknown fields', () => {
    expect(SettingsPatchSchema.safeParse({ piano: { volume: 3 } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ piano: { loud: true } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ controller: { padNotes: [1] } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({}).success).toBe(true);
  });

  it('keeps sound input off by default and its sensitivity inside 0..1', () => {
    expect(DEFAULT_SETTINGS.audioInput).toEqual({ enabled: false, sensitivity: 0.5, deviceId: '' });
    const old = parseSettings(JSON.stringify({ piano: { enabled: true } }));
    expect(old.audioInput).toEqual(DEFAULT_SETTINGS.audioInput);
    const stiff = mergeSettings(DEFAULT_SETTINGS, { audioInput: { sensitivity: 0 } });
    expect(stiff.audioInput.sensitivity).toBe(0);
    expect(mergeSettings(stiff, { audioInput: { sensitivity: 1.5 } })).toBe(stiff);
    const damaged = parseSettings(JSON.stringify({ audioInput: { sensitivity: 'loud' } }));
    expect(damaged.audioInput).toEqual(DEFAULT_SETTINGS.audioInput);
  });
});
