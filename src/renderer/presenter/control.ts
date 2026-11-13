import { create } from 'zustand';
import type { Action } from '../actions';
import { flushSaves, getCurrentSlideIndex, serialiseDeck, useDeckStore } from '../deck';
import { MidiInputState } from '../midi';
import { api } from '../shared/api';
import { logger } from '../shared/log';
import { notify } from '../shared/notify';
import {
  StageMessageSchema,
  type ControlMessage,
  type StageReport,
  type StageState,
} from './messages';

const DISPLAY_KEY = 'stagekeys.show.display';

export interface PresenterState {
  active: boolean;
  rehearsal: boolean;
  /** Latest status from the stage window. null until the stage reports in. */
  stage: StageState | null;
  /** Timings from the most recent rehearsal, shown after it ends. */
  report: StageReport | null;
  displayId: number | null;
}

export const usePresenterStore = create<PresenterState>(() => ({
  active: false,
  rehearsal: false,
  stage: null,
  report: null,
  displayId: readDisplay(),
}));

function readDisplay(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(DISPLAY_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function setShowDisplay(displayId: number | null): void {
  usePresenterStore.setState({ displayId });
  try {
    if (displayId === null) globalThis.localStorage?.removeItem(DISPLAY_KEY);
    else globalThis.localStorage?.setItem(DISPLAY_KEY, String(displayId));
  } catch {
    // Not persisted; harmless.
  }
}

export function dismissReport(): void {
  usePresenterStore.setState({ report: null });
}

interface BridgeHooks {
  /** Release MIDI so the stage window can take it. */
  onShowStarting: () => void;
  /** Take MIDI back for the editor. */
  onShowEnded: () => void;
}

/** A mirror of the stage's MIDI state, for the keys picture in the presenter view. */
export const presenterInput = new MidiInputState();

function mirrorInput(state: StageState): void {
  const input = presenterInput;
  input.held.clear();
  input.heldChannel.clear();
  for (const [note, velocity, channel] of state.held) {
    input.held.set(note, velocity);
    input.heldChannel.set(note, channel);
  }
  input.cc.fill(0);
  for (const [cc, value] of state.cc) if (cc >= 0 && cc < 128) input.cc[cc] = value;
  input.pitchBend = state.pitchBend;
  input.sustain = state.sustain;
  input.version++;
}

let hooks: BridgeHooks = { onShowStarting: () => undefined, onShowEnded: () => undefined };

/** Wires the control window to the stage. Call once at startup. */
export function initShowBridge(bridgeHooks: BridgeHooks): void {
  hooks = bridgeHooks;
  api().onShowMessage((raw) => {
    const parsed = StageMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === 'state') {
      usePresenterStore.setState({ stage: message });
      mirrorInput(message);
    } else if (message.t === 'report') {
      logger.info('Show report', message);
      if (message.rehearsal) usePresenterStore.setState({ report: message });
    } else {
      notify(message.level, message.message);
    }
  });
  api().onShowEnded(() => {
    if (!usePresenterStore.getState().active) return;
    usePresenterStore.setState({ active: false, stage: null });
    hooks.onShowEnded();
  });
}

export async function startShow(rehearsal: boolean): Promise<void> {
  const { deck, path } = useDeckStore.getState();
  if (!deck || !path || usePresenterStore.getState().active) return;
  // Make sure what is on disk matches what is about to be presented.
  const saveError = await flushSaves();
  if (saveError)
    notify('warn', 'The deck could not be saved, but the show will use your latest edits.');

  let displayId = usePresenterStore.getState().displayId;
  const displays = await api().listDisplays();
  if (displayId === null || !displays.some((d) => d.id === displayId)) {
    // Prefer an external display; fall back to the only one there is.
    displayId = (displays.find((d) => !d.primary) ?? displays[0])?.id ?? null;
  }

  hooks.onShowStarting();
  usePresenterStore.setState({ active: true, rehearsal, stage: null, report: null });
  const started = await api().startShow({
    displayId,
    deckJson: serialiseDeck(deck),
    deckPath: path,
    slideIndex: getCurrentSlideIndex(),
    rehearsal,
  });
  if (!started.ok) {
    usePresenterStore.setState({ active: false });
    hooks.onShowEnded();
    notify('error', `Could not start the show: ${started.error}`);
  }
}

/** Sends an action to the stage window, where the show actually runs. */
export function sendToStage(action: Action, source: 'keyboard' | 'ui'): void {
  const message: ControlMessage = { t: 'action', action, source };
  api().sendShowMessage(message);
}
