import type { Migration } from './index';

/**
 * Version 1 → 2. Version 2 lets an animation binding follow the sound input
 * (`audioLevel`, `audioBass`, `audioMid`, `audioTreble`, `audioBeat`) as well
 * as MIDI. Nothing in a version 1 deck needs rewriting: every binding it holds
 * is still valid. The version is bumped so that an older Stagekeys refuses a
 * deck with sound bindings clearly, rather than failing to read it.
 */
export const audioBindings: Migration = (deck) => deck;
