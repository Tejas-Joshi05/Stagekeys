export {};

declare global {
  interface Window {
    __stagekeysMidi?: (bytes: number[]) => void;
    __stagekeysAudio?: (
      raw: { level: number; bass: number; mid: number; treble: number } | null,
    ) => void;
    __stagekeysStage?: {
      slideIndex: () => number;
      black: () => boolean;
      fps: () => number;
      sound: () => number;
    };
  }
}
