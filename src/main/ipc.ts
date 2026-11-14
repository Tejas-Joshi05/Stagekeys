import {
  app,
  dialog,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
} from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  CHANNELS,
  DECK_EXTENSION,
  err,
  ok,
  type AppInfo,
  type DeckFile,
  type DisplayInfo,
  type ImportedAsset,
  type Result,
} from '../ipc/contract';
import { DEFAULT_SETTINGS, SettingsPatchSchema } from '../ipc/settings';
import * as files from './deckFiles';
import { getLogDir, log } from './log';
import { getSettings, updateSettings } from './settings';
import {
  endShow,
  finishControlClose,
  getControlWindow,
  getShowInit,
  isE2E,
  isShowActive,
  relayShowMessage,
  startShow,
} from './windows';

const bundlePath = z.string().refine(files.isBundlePath, 'Expected an absolute .stagekeys path');
const fileName = z.string().min(1).max(255);
const jsonText = z.string().max(64 * 1024 * 1024);

const SHOW_BLOCKED = 'Not available while a show is running.';

export function draftsDir(): string {
  return path.join(app.getPath('userData'), 'drafts');
}

function isDraft(p: string): boolean {
  return path.resolve(p).startsWith(path.resolve(draftsDir()) + path.sep);
}

/** Registers a handler whose arguments are validated before the handler runs. */
function handle<A extends z.ZodTuple, R>(
  channel: string,
  args: A,
  handler: (args: z.infer<A>, event: IpcMainInvokeEvent) => Promise<R> | R,
  onInvalid: (message: string) => R,
): void {
  ipcMain.handle(channel, async (event, ...raw: unknown[]) => {
    const parsed = args.safeParse(raw);
    if (!parsed.success) {
      log('warn', 'ipc', `Rejected invalid arguments for ${channel}`, parsed.error.message);
      return onInvalid(`Invalid arguments for ${channel}`);
    }
    try {
      return await handler(parsed.data, event);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log('error', 'ipc', `Handler ${channel} failed`, message);
      return onInvalid(message);
    }
  });
}

const fail = <T>(message: string): Result<T> => err(message);

async function readDeckFile(p: string): Promise<Result<DeckFile>> {
  const text = await files.readDeck(p);
  return text.ok ? ok({ path: p, json: text.value, isDraft: isDraft(p) }) : err(text.error);
}

export function registerIpc(): void {
  handle(
    CHANNELS.getInfo,
    z.tuple([]),
    (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      isDev: !app.isPackaged,
      e2e: isE2E,
      logDir: getLogDir(),
    }),
    () => ({ version: '', platform: process.platform, isDev: false, e2e: isE2E, logDir: '' }),
  );

  handle(
    CHANNELS.createDraft,
    z.tuple([jsonText]),
    ([json]) => files.createDraft(draftsDir(), json),
    fail<string>,
  );
  handle(
    CHANNELS.listDrafts,
    z.tuple([]),
    () => files.listDrafts(draftsDir()),
    () => [],
  );
  handle(
    CHANNELS.deleteDraft,
    z.tuple([bundlePath]),
    ([p]) => files.deleteDraft(draftsDir(), p),
    fail<null>,
  );

  handle(
    CHANNELS.openDeckDialog,
    z.tuple([]),
    async (): Promise<Result<DeckFile | null>> => {
      if (isShowActive()) return err(SHOW_BLOCKED);
      let chosen: string | undefined = process.env.STAGEKEYS_E2E_OPEN_PATH;
      if (!isE2E || !chosen) {
        const win = getControlWindow();
        if (!win) return ok(null);
        const result = await dialog.showOpenDialog(win, {
          title: 'Open Deck',
          // On macOS a bundle with an extension may appear as a file or a folder.
          properties: ['openDirectory', 'openFile'],
          message: `Choose a ${DECK_EXTENSION} deck folder`,
        });
        chosen = result.canceled ? undefined : result.filePaths[0];
      }
      if (!chosen) return ok(null);
      // Allow picking deck.json inside the bundle as well as the bundle itself.
      if (path.basename(chosen) === files.DECK_JSON) chosen = path.dirname(chosen);
      if (!files.isBundlePath(chosen)) {
        return err(`"${path.basename(chosen)}" is not a ${DECK_EXTENSION} deck folder.`);
      }
      return readDeckFile(chosen);
    },
    fail<DeckFile | null>,
  );
  handle(CHANNELS.readDeck, z.tuple([bundlePath]), ([p]) => readDeckFile(p), fail<DeckFile>);
  handle(
    CHANNELS.writeDeck,
    z.tuple([bundlePath, jsonText, z.boolean()]),
    ([p, json, backup]) => files.writeDeck(p, json, backup),
    fail<null>,
  );
  handle(
    CHANNELS.saveDeckAs,
    z.tuple([bundlePath, z.string().max(200)]),
    async ([from, suggested]): Promise<Result<string | null>> => {
      if (isShowActive()) return err(SHOW_BLOCKED);
      let target: string | undefined = process.env.STAGEKEYS_E2E_SAVE_PATH;
      if (!isE2E || !target) {
        const win = getControlWindow();
        if (!win) return ok(null);
        const safe = suggested.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
        const result = await dialog.showSaveDialog(win, {
          title: 'Save Deck',
          defaultPath: path.join(app.getPath('documents'), `${safe}${DECK_EXTENSION}`),
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        target = result.canceled ? undefined : result.filePath;
      }
      if (!target) return ok(null);
      if (!target.endsWith(DECK_EXTENSION)) target += DECK_EXTENSION;
      const existing = await fs.stat(target).catch(() => null);
      if (existing?.isFile()) return err('A file with that name already exists there.');
      const copied = await files.copyBundle(from, target);
      return copied.ok ? ok(target) : err(copied.error);
    },
    fail<string | null>,
  );
  handle(
    CHANNELS.listBackups,
    z.tuple([bundlePath]),
    ([p]) => files.listBackups(p),
    () => [],
  );
  handle(
    CHANNELS.readBackup,
    z.tuple([bundlePath, fileName]),
    ([p, name]) => files.readBackup(p, name),
    fail<string>,
  );

  handle(
    CHANNELS.importImages,
    z.tuple([bundlePath]),
    async ([deck]): Promise<Result<ImportedAsset[]>> => {
      if (isShowActive()) return err(SHOW_BLOCKED);
      let sources: string[];
      const e2eImage = process.env.STAGEKEYS_E2E_IMAGE_PATH;
      if (isE2E && e2eImage) {
        sources = [e2eImage];
      } else {
        const win = getControlWindow();
        if (!win) return ok([]);
        const result = await dialog.showOpenDialog(win, {
          title: 'Add Images',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Images', extensions: files.IMAGE_EXTENSIONS }],
        });
        sources = result.canceled ? [] : result.filePaths;
      }
      const imported: ImportedAsset[] = [];
      for (const source of sources) {
        const one = await files.importAsset(deck, source);
        if (!one.ok) return err(`${path.basename(source)}: ${one.error}`);
        imported.push(one.value);
      }
      return ok(imported);
    },
    fail<ImportedAsset[]>,
  );
  handle(
    CHANNELS.readAsset,
    z.tuple([bundlePath, fileName]),
    ([deck, file]) => files.readAsset(deck, file),
    fail<Uint8Array>,
  );

  handle(
    CHANNELS.saveTextFile,
    z.tuple([
      z.object({
        title: z.string().max(200),
        defaultName: z.string().max(200),
        extension: z.string().regex(/^[a-z0-9]+$/),
        content: jsonText,
      }),
    ]),
    async ([options]): Promise<Result<string | null>> => {
      if (isShowActive()) return err(SHOW_BLOCKED);
      const win = getControlWindow();
      if (!win) return ok(null);
      const result = await dialog.showSaveDialog(win, {
        title: options.title,
        defaultPath: path.join(app.getPath('documents'), options.defaultName),
        filters: [{ name: options.extension.toUpperCase(), extensions: [options.extension] }],
      });
      if (result.canceled || !result.filePath) return ok(null);
      await files.atomicWrite(result.filePath, options.content);
      return ok(result.filePath);
    },
    fail<string | null>,
  );
  handle(
    CHANNELS.openTextFile,
    z.tuple([z.object({ title: z.string().max(200), extension: z.string().regex(/^[a-z0-9]+$/) })]),
    async ([options]): Promise<Result<string | null>> => {
      if (isShowActive()) return err(SHOW_BLOCKED);
      const win = getControlWindow();
      if (!win) return ok(null);
      const result = await dialog.showOpenDialog(win, {
        title: options.title,
        properties: ['openFile'],
        filters: [{ name: options.extension.toUpperCase(), extensions: [options.extension] }],
      });
      const file = result.canceled ? undefined : result.filePaths[0];
      if (!file) return ok(null);
      return ok(await fs.readFile(file, 'utf8'));
    },
    fail<string | null>,
  );

  handle(
    CHANNELS.chooseExportFolder,
    z.tuple([]),
    async (): Promise<Result<string | null>> => {
      if (isShowActive()) return err(SHOW_BLOCKED);
      const e2eDir = process.env.STAGEKEYS_E2E_EXPORT_DIR;
      if (isE2E && e2eDir) return ok(e2eDir);
      const win = getControlWindow();
      if (!win) return ok(null);
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose Export Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      return ok(result.canceled ? null : (result.filePaths[0] ?? null));
    },
    fail<string | null>,
  );
  handle(
    CHANNELS.writeExportFile,
    z.tuple([z.string().refine((p) => path.isAbsolute(p)), fileName, z.instanceof(Uint8Array)]),
    async ([dir, name, bytes]): Promise<Result<string>> => {
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, path.basename(name));
      await files.atomicWrite(target, bytes);
      return ok(target);
    },
    fail<string>,
  );

  handle(
    CHANNELS.listDisplays,
    z.tuple([]),
    (): DisplayInfo[] => {
      const primary = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d, i) => ({
        id: d.id,
        label: d.label || `Display ${i + 1}`,
        width: d.size.width,
        height: d.size.height,
        primary: d.id === primary,
      }));
    },
    () => [],
  );
  handle(
    CHANNELS.startShow,
    z.tuple([
      z.object({
        displayId: z.number().nullable(),
        deckJson: jsonText,
        deckPath: bundlePath,
        slideIndex: z.number().int().min(0),
        rehearsal: z.boolean(),
      }),
    ]),
    ([start]): Result<null> => {
      startShow(start);
      return ok(null);
    },
    fail<null>,
  );
  handle(
    CHANNELS.endShow,
    z.tuple([]),
    () => endShow(),
    () => undefined,
  );
  handle(
    CHANNELS.getShowInit,
    z.tuple([]),
    () => getShowInit(),
    () => null,
  );

  handle(
    CHANNELS.getSettings,
    z.tuple([]),
    () => getSettings(),
    () => DEFAULT_SETTINGS,
  );
  handle(
    CHANNELS.updateSettings,
    z.tuple([SettingsPatchSchema]),
    ([patch]) => updateSettings(patch),
    () => DEFAULT_SETTINGS,
  );

  handle(
    CHANNELS.requestMicrophone,
    z.tuple([]),
    async () => {
      // Only macOS has an app-level microphone switch that Electron can ask about.
      if (process.platform !== 'darwin') return true;
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') return true;
      // The system prompt is a dialog, so it is never raised mid-show or in tests.
      if (status !== 'not-determined' || isShowActive() || isE2E) return false;
      return systemPreferences.askForMediaAccess('microphone');
    },
    () => false,
  );

  ipcMain.on(CHANNELS.showMessage, (event, message: unknown) => {
    relayShowMessage(event.sender, message);
  });
  ipcMain.on(CHANNELS.flushDone, (event, error: unknown) => {
    if (event.sender !== getControlWindow()?.webContents) return;
    finishControlClose(typeof error === 'string' ? error : null);
  });
  ipcMain.on(CHANNELS.log, (_event, level: unknown, message: unknown, data: unknown) => {
    const parsed = z.enum(['debug', 'info', 'warn', 'error']).safeParse(level);
    if (parsed.success && typeof message === 'string') {
      log(parsed.data, 'renderer', message.slice(0, 4000), data);
    }
  });
  handle(
    CHANNELS.openLogFolder,
    z.tuple([]),
    async () => {
      if (isShowActive()) return;
      await shell.openPath(getLogDir());
    },
    () => undefined,
  );
}
