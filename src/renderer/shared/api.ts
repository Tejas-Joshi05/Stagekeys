import type { StagekeysApi } from '../../ipc/contract';

declare global {
  interface Window {
    stagekeys?: StagekeysApi;
  }
}

/** The preload bridge. Throws if called outside Electron (unit tests inject their own fakes). */
export function api(): StagekeysApi {
  const bridge = typeof window === 'undefined' ? undefined : window.stagekeys;
  if (!bridge) throw new Error('Stagekeys bridge is not available');
  return bridge;
}

export function hasApi(): boolean {
  return typeof window !== 'undefined' && window.stagekeys !== undefined;
}
