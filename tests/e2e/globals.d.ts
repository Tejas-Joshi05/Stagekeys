export {};

declare global {
  interface Window {
    __stagekeysMidi?: (bytes: number[]) => void;
    __stagekeysStage?: { slideIndex: () => number; black: () => boolean; fps: () => number };
  }
}
