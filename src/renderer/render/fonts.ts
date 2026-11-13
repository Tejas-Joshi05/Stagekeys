import '@fontsource-variable/familjen-grotesk';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';

/** Open-licence (SIL OFL) fonts shipped inside the app. These render the same on every machine. */
export const BUNDLED_FONTS = [
  'Familjen Grotesk Variable',
  'IBM Plex Mono',
  'Inter Variable',
  'Space Grotesk Variable',
  'JetBrains Mono Variable',
] as const;

/** Common system fonts offered when the full list cannot be read. Only the ones present are shown. */
const COMMON_SYSTEM_FONTS = [
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Avenir Next',
  'Futura',
  'Gill Sans',
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Baskerville',
  'Didot',
  'Optima',
  'Menlo',
  'Courier New',
  'SF Pro Display',
  'Segoe UI',
  'Calibri',
  'Cambria',
  'Consolas',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
];

export function isBundledFont(family: string): boolean {
  return (BUNDLED_FONTS as readonly string[]).includes(family);
}

/**
 * Loads the bundled fonts before anything is drawn. Canvas text silently
 * falls back to a default font if the real one has not loaded yet.
 */
export async function loadBundledFonts(): Promise<void> {
  const loads = BUNDLED_FONTS.flatMap((family) =>
    [400, 500, 700].map((weight) => document.fonts.load(`${weight} 48px "${family}"`)),
  );
  await Promise.allSettled(loads);
}

interface LocalFont {
  family: string;
}

let systemFonts: Promise<string[]> | null = null;

/** System font families, where the platform lets us read them; otherwise a checked shortlist. */
export function listSystemFonts(): Promise<string[]> {
  systemFonts ??= (async () => {
    try {
      const query = (window as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
      if (query) {
        const fonts = await query.call(window);
        const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) =>
          a.localeCompare(b),
        );
        if (families.length > 0) return families;
      }
    } catch {
      // Permission denied or unsupported: fall through to the shortlist.
    }
    return COMMON_SYSTEM_FONTS.filter((family) => {
      try {
        return document.fonts.check(`16px "${family}"`);
      } catch {
        return false;
      }
    });
  })();
  return systemFonts;
}
