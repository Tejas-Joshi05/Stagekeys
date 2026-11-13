import { useEffect, useRef } from 'react';
import type { ControllerProfile } from '../../ipc/settings';
import { useSettings } from '../shared/settings';
import type { MidiInputState } from './inputState';
import { KeysOverlay } from './keysOverlay';

interface Props {
  input: MidiInputState;
  width?: number;
  /** Profile to draw with; defaults to the one in settings. */
  profile?: ControllerProfile;
  className?: string;
}

/** The little MPK mini IV picture. Redraws itself from MIDI state; React renders it once. */
export function KeysOverlayView({ input, width = 260, profile, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<KeysOverlay | null>(null);
  const fixed = useRef(profile);
  useEffect(() => {
    fixed.current = profile;
  }, [profile]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const o = new KeysOverlay(el, input, () => fixed.current ?? useSettings.getState().controller);
    overlay.current = o;
    o.start();
    return () => {
      o.stop();
      overlay.current = null;
    };
  }, [input]);

  useEffect(() => {
    overlay.current?.setWidth(width);
  }, [width, input]);

  return (
    <canvas
      ref={canvas}
      className={className ? `keys-overlay ${className}` : 'keys-overlay'}
      data-testid="keys-overlay"
      aria-label="Keys being played"
    />
  );
}
