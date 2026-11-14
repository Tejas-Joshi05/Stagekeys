import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../ipc/settings';
import {
  AUDIO_STATUS_TEXT,
  audioInput,
  AudioMeter,
  listAudioInputs,
  setAudioSensitivity,
  useAudioInputStore,
  type AudioDevice,
} from '../audio';
import { useDeckStore } from '../deck';
import { controlPicker } from '../mapping';
import {
  DevicePicker,
  KeyboardDiagram,
  KeysOverlayView,
  midi,
  MidiMonitor,
  MOD_CC,
  SUSTAIN_CC,
} from '../midi';
import { updateSettings, useSettings } from '../shared/settings';
import { noteName } from '../shared/util';
import { CheckField, Section, SelectField } from './fields';

type Teaching = { what: 'pads' | 'knobs'; got: number[]; channel: number } | null;

/**
 * Teaches Stagekeys which notes the pads send and which CCs the knobs send,
 * one control at a time. While teaching, the controls do nothing else.
 */
function ControllerSetup() {
  const profile = useSettings((s) => s.controller);
  const [teaching, setTeaching] = useState<Teaching>(null);
  const progress = useRef<Teaching>(null);

  useEffect(() => {
    if (!teaching) return;
    progress.current = teaching;
    controlPicker.enabled = true; // swallow the presses so no mapping fires
    const unsubscribe = midi.bus.subscribe((m) => {
      const t = progress.current;
      if (!t) return;
      let value: number | null = null;
      let channel = t.channel;
      if (t.what === 'pads' && m.type === 'noteOn') {
        value = m.note;
        channel = m.channel;
      }
      if (
        t.what === 'knobs' &&
        m.type === 'cc' &&
        m.controller !== MOD_CC &&
        m.controller !== SUSTAIN_CC
      ) {
        value = m.controller;
      }
      if (value === null || t.got.includes(value)) return;
      const got = [...t.got, value];
      if (got.length === 8) {
        progress.current = null;
        updateSettings({
          controller: t.what === 'pads' ? { padNotes: got, padChannel: channel } : { knobCCs: got },
        });
        setTeaching(null);
      } else {
        progress.current = { ...t, got, channel };
        setTeaching(progress.current);
      }
    });
    return () => {
      unsubscribe();
      controlPicker.enabled = false;
    };
    // Re-subscribing on every step would be wasteful; progress lives in the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teaching?.what]);

  const step = teaching ? teaching.got.length + 1 : 0;
  return (
    <Section title="Your MPK mini">
      <p className="hint">
        Stagekeys assumes the pads send notes {noteName(profile.padNotes[0] ?? 36)}–
        {noteName(profile.padNotes[7] ?? 43)} on channel {profile.padChannel} and the knobs send CC{' '}
        {profile.knobCCs.join(', ')}. If your presets differ, teach it.
      </p>
      {teaching ? (
        <div className="teaching" data-testid="teaching">
          <strong>{teaching.what === 'pads' ? `Hit pad ${step}` : `Turn knob ${step}`}</strong>{' '}
          <span className="muted">({step} of 8)</span>
          <button className="link" onClick={() => setTeaching(null)}>
            Stop
          </button>
        </div>
      ) : (
        <div className="row">
          <button
            onClick={() => setTeaching({ what: 'pads', got: [], channel: profile.padChannel })}
          >
            Teach the pads
          </button>
          <button onClick={() => setTeaching({ what: 'knobs', got: [], channel: 0 })}>
            Teach the knobs
          </button>
        </div>
      )}
      <div className="grid2">
        <SelectField
          label="Pads send on channel"
          value={String(profile.padChannel)}
          options={Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
          onChange={(v) => updateSettings({ controller: { padChannel: Number(v) } })}
        />
        <SelectField
          label="Keys start at"
          value={String(profile.keysLow)}
          options={[24, 36, 48, 60, 72].map((n) => ({ value: String(n), label: noteName(n) }))}
          onChange={(v) => updateSettings({ controller: { keysLow: Number(v) } })}
        />
      </div>
      <button
        className="link"
        onClick={() => updateSettings({ controller: DEFAULT_SETTINGS.controller })}
      >
        Back to factory assumptions
      </button>
    </Section>
  );
}

function PianoSetup() {
  const piano = useSettings((s) => s.piano);
  return (
    <Section
      title="Piano sound"
      actions={
        <label className="switch big" data-testid="piano-toggle">
          <input
            type="checkbox"
            checked={piano.enabled}
            onChange={(e) => updateSettings({ piano: { enabled: e.target.checked } })}
          />
          <span>{piano.enabled ? 'On' : 'Off'}</span>
        </label>
      }
    >
      <p className="hint">
        Plays each key you press through this Mac’s sound output. Toggle it with ⇧⌘P, or P during a
        show.
      </p>
      <div className="segmented small" role="radiogroup" aria-label="Sound">
        {(
          [
            ['felt', 'Felt'],
            ['grand', 'Grand'],
            ['electric', 'Electric'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={piano.sound === value ? 'on' : ''}
            role="radio"
            aria-checked={piano.sound === value}
            onClick={() => updateSettings({ piano: { sound: value } })}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="field wide">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={piano.volume}
          onChange={(e) => updateSettings({ piano: { volume: Number(e.target.value) } })}
        />
      </label>
      <CheckField
        label="Keys that do something (next slide…) stay silent"
        value={piano.skipMapped}
        onChange={(skipMapped) => updateSettings({ piano: { skipMapped } })}
      />
      <CheckField
        label="Pads play notes too"
        value={piano.pads}
        onChange={(pads) => updateSettings({ piano: { pads } })}
      />
    </Section>
  );
}

const readAudio = () => audioInput.read();

function sensitivityWord(value: number): string {
  if (value >= 0.97) return 'as sensitive as it gets';
  if (value >= 0.75) return 'very sensitive';
  if (value >= 0.55) return 'sensitive';
  if (value >= 0.45) return 'balanced';
  if (value >= 0.25) return 'firm';
  if (value > 0.03) return 'stiff';
  return 'as stiff as it gets';
}

/** Sound coming in, for audio-reactive animations: on/off, which input, how sensitive, and a meter. */
function SoundInputSetup() {
  const settings = useSettings((s) => s.audioInput);
  const status = useAudioInputStore((s) => s.status);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  // The slider moves at once; the setting itself is saved a moment later.
  const [sensitivity, setSensitivity] = useState(settings.sensitivity);
  useEffect(() => setSensitivity(settings.sensitivity), [settings.sensitivity]);

  // Device names are only readable once the input is open.
  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void listAudioInputs().then((list) => {
        if (!cancelled) setDevices(list);
      });
    };
    refresh();
    const media = navigator.mediaDevices as MediaDevices | undefined;
    media?.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      media?.removeEventListener('devicechange', refresh);
    };
  }, [status]);

  const known = devices.some((d) => d.id === settings.deviceId);
  return (
    <Section
      title="Sound input"
      actions={
        <label className="switch big" data-testid="audio-input-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => updateSettings({ audioInput: { enabled: e.target.checked } })}
          />
          <span>{settings.enabled ? 'On' : 'Off'}</span>
        </label>
      }
    >
      <p className="hint">
        Lets animations react to sound: your voice, the room, music. It is only measured, never
        recorded. Toggle it with ⇧⌘L, or L during a show.
      </p>
      <AudioMeter read={readAudio} />
      <p
        className={status === 'blocked' || status === 'no-input' ? 'hint warn' : 'hint'}
        data-testid="audio-input-status"
      >
        {AUDIO_STATUS_TEXT[status]}
      </p>
      <label className="field wide">
        <span>
          Sensitivity:{' '}
          <strong data-testid="audio-sensitivity-word">{sensitivityWord(sensitivity)}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sensitivity}
          data-testid="audio-sensitivity"
          aria-label="Sound sensitivity, from stiffest to most sensitive"
          onChange={(e) => {
            const value = Number(e.target.value);
            setSensitivity(value);
            setAudioSensitivity(value);
          }}
        />
        <span className="range-ends">
          <span>stiff</span>
          <span>sensitive</span>
        </span>
      </label>
      <SelectField
        label="Input"
        wide
        value={known ? settings.deviceId : ''}
        options={[
          { value: '', label: 'System default' },
          ...devices.map((d) => ({ value: d.id, label: d.label })),
        ]}
        onChange={(deviceId) => updateSettings({ audioInput: { deviceId } })}
      />
      <p className="hint">
        Map a knob to “Set sound sensitivity” in the Mapping tab to ride it live. Any animation
        setting can also follow the sound: see “MIDI and sound bindings” on an animation.
      </p>
    </Section>
  );
}

function KeysPictureSetup() {
  const overlay = useSettings((s) => s.keysOverlay);
  return (
    <Section title="Keys picture">
      <KeysOverlayView input={midi.input} width={296} className="preview" />
      <p className="hint">
        A small MPK mini that lights up as you play. Toggle it with ⇧⌘K, or K during a show.
      </p>
      <CheckField
        label="Show in the editor and presenter view"
        value={overlay.control}
        onChange={(control) => updateSettings({ keysOverlay: { control } })}
      />
      <CheckField
        label="Show on the audience screen"
        value={overlay.stage}
        onChange={(stage) => updateSettings({ keysOverlay: { stage } })}
      />
      <SelectField
        label="Corner"
        wide
        value={overlay.corner}
        options={[
          { value: 'bottom-right', label: 'Bottom right' },
          { value: 'bottom-left', label: 'Bottom left' },
          { value: 'top-right', label: 'Top right' },
          { value: 'top-left', label: 'Top left' },
        ]}
        onChange={(corner) => updateSettings({ keysOverlay: { corner } })}
      />
    </Section>
  );
}

/** Device, sound, the keys picture, controller setup, the live monitor, and a dev keyboard. */
export function MidiPanel({ virtualKeyboard }: { virtualKeyboard: boolean }) {
  const zones = useDeckStore((s) => s.deck?.zones);
  return (
    <div className="panel-scroll" data-testid="midi-panel">
      <Section title="Device">
        <DevicePicker />
      </Section>
      <PianoSetup />
      <SoundInputSetup />
      <KeysPictureSetup />
      <ControllerSetup />
      <Section title="Monitor">
        <MidiMonitor bus={midi.bus} />
      </Section>
      {virtualKeyboard && (
        <Section title="Virtual keyboard (development)">
          <KeyboardDiagram
            zones={zones}
            input={midi.input}
            from={48}
            to={84}
            onNote={(note, down) => midi.inject(down ? [0x90, note, 100] : [0x80, note, 0])}
          />
          <p className="hint">Click keys to send notes as if a keyboard were plugged in.</p>
        </Section>
      )}
    </div>
  );
}
