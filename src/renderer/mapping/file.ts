import { newId } from '../shared/util';
import {
  MAPPING_FILE_FORMAT,
  MappingFileSchema,
  type Mapping,
  type MappingFile,
  type Zone,
} from './types';

export function serialiseMappings(mappings: readonly Mapping[], zones: readonly Zone[]): string {
  const file: MappingFile = {
    format: MAPPING_FILE_FORMAT,
    version: 1,
    mappings: [...mappings],
    zones: [...zones],
  };
  return JSON.stringify(file, null, 2);
}

export type ParsedMappingFile =
  { ok: true; mappings: Mapping[]; zones: Zone[] } | { ok: false; error: string };

/** Validates an imported mapping file. Imported items get fresh ids so they never clash. */
export function parseMappingFile(text: string): ParsedMappingFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  const parsed = MappingFileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'This is not a Stagekeys mapping file, or it is damaged.' };
  }
  return {
    ok: true,
    mappings: parsed.data.mappings.map((m) => ({ ...m, id: newId('map') })),
    zones: parsed.data.zones.map((z) => ({ ...z, id: newId('zone') })),
  };
}
