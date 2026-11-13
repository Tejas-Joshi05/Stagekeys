import { create } from 'zustand';

export type RightTab = 'properties' | 'mappings' | 'midi';

interface EditorUiState {
  rightTab: RightTab;
  fpsVisible: boolean;
  /** Mapping card to expand and scroll to (set when a mapping is created from elsewhere). */
  focusMappingId: string | null;
}

export const useEditorUi = create<EditorUiState>(() => ({
  rightTab: 'properties',
  fpsVisible: false,
  focusMappingId: null,
}));
