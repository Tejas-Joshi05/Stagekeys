import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * End-to-end smoke test against the built app:
 * launch → create deck → add slide → add text → save → reopen → map a key on the controller map →
 * present → advance via mock MIDI → keyboard fallback → exit, with a clean log.
 */

let work = '';

async function launch(): Promise<{ app: ElectronApplication; win: Page }> {
  // VS Code terminals set ELECTRON_RUN_AS_NODE, which would make Electron behave as plain Node.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...env,
      STAGEKEYS_E2E: '1',
      STAGEKEYS_USER_DATA: path.join(work, 'profile'),
      STAGEKEYS_E2E_SAVE_PATH: path.join(work, 'Smoke.stagekeys'),
      STAGEKEYS_E2E_OPEN_PATH: path.join(work, 'Smoke.stagekeys'),
      STAGEKEYS_E2E_EXPORT_DIR: path.join(work, 'export'),
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

const readDeck = async (): Promise<{
  slides: { elements: { type: string }[]; notes: string }[];
  mappings: unknown[];
}> => JSON.parse(await readFile(path.join(work, 'Smoke.stagekeys', 'deck.json'), 'utf8'));

test.beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'stagekeys-e2e-'));
});
test.afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

test('create, save, reopen, present with mock MIDI, exit', async () => {
  // ── Create and save ───────────────────────────────────────────────────────
  let { app, win } = await launch();
  await win.getByTestId('new-deck').click();
  await expect(win.getByTestId('editor')).toBeVisible();
  await expect(win.getByTestId('slide-canvas')).toBeVisible();

  await win.getByTestId('add-slide').click();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(2);

  await win.getByTestId('add-text').click();
  await expect(win.getByTestId('prop-x')).toBeVisible();
  await win.getByTestId('notes').fill('Second slide notes');

  await win.getByTestId('save').click();
  await expect(win.getByTestId('save-status')).toHaveText('Saved');
  const saved = await readDeck();
  expect(saved.slides).toHaveLength(2);
  expect(saved.slides[1]?.elements.map((e) => e.type)).toEqual(['text']);
  expect(saved.slides[1]?.notes).toBe('Second slide notes');

  // Undo and redo go through the same action system as everything else.
  await win.getByTestId('undo').click();
  await win.getByTestId('redo').click();

  await app.close();

  // ── Reopen ────────────────────────────────────────────────────────────────
  ({ app, win } = await launch());
  await expect(win.getByTestId('drafts')).toHaveCount(0); // Save As removed the draft
  await win.getByTestId('open-deck').click();
  await expect(win.getByTestId('editor')).toBeVisible();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(2);
  const backups = await readdir(path.join(work, 'Smoke.stagekeys', 'backups'));
  expect(backups.length).toBeGreaterThan(0);

  // ── Map a key on the controller map ───────────────────────────────────────
  // With the Mapping tab open, pressing a key chooses it instead of acting.
  await win.getByTestId('tab-mappings').click();
  await expect(win.getByTestId('controller-map')).toBeVisible();
  await win.evaluate(() => window.__stagekeysMidi?.([0x90, 60, 100]));
  await expect(win.getByTestId('control-name')).toContainText('C4');
  await win.getByTestId('action-nav.next').click();
  await expect(win.getByTestId('mapping-input')).toHaveText('C4');
  await expect(win.getByTestId('mapping-card')).toHaveCount(1);
  // Still on slide 1: picking did not fire the new mapping.
  await expect(win.getByTestId('slide-thumb').nth(1)).not.toHaveClass(/selected/);

  // The monitor shows the key press.
  await win.getByTestId('tab-midi').click();
  await expect(win.getByTestId('midi-monitor')).toContainText('Note on');

  // ── Present ───────────────────────────────────────────────────────────────
  await win.getByTestId('slide-thumb').first().click();
  const stagePromise = app.waitForEvent('window');
  await win.getByTestId('present').click();
  const stage = await stagePromise;
  await stage.waitForFunction(() => window.__stagekeysStage !== undefined);
  await expect(win.getByTestId('presenter-view')).toBeVisible();
  expect(await stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(0);
  await expect(win.getByTestId('presenter-slide-count')).toHaveText('Slide 1 / 2');

  // Advance with (mock) MIDI: the mapped key moves to the next slide.
  await stage.evaluate(() => window.__stagekeysMidi?.([0x90, 60, 100]));
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(1);
  await expect(win.getByTestId('presenter-slide-count')).toHaveText('Slide 2 / 2');
  await expect(win.getByTestId('presenter-notes')).toHaveText('Second slide notes');

  // Keyboard fallback works on the stage and from the presenter view.
  await stage.keyboard.press('ArrowLeft');
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(0);
  await win.getByTestId('presenter-next').click();
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(1);

  // Black screen toggle.
  await stage.keyboard.press('b');
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.black())).toBe(true);
  await stage.keyboard.press('b');

  // The stage is actually rendering frames.
  await expect
    .poll(() => stage.evaluate(() => window.__stagekeysStage?.fps() ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(20);

  // ── Exit the show ─────────────────────────────────────────────────────────
  const closed = stage.waitForEvent('close');
  await win.getByTestId('presenter-end').click();
  await closed;
  await expect(win.getByTestId('editor')).toBeVisible();

  await app.close();

  // ── Nothing went wrong along the way ──────────────────────────────────────
  const log = await readFile(path.join(work, 'profile', 'logs', 'stagekeys.log'), 'utf8');
  const errors = log.split('\n').filter((line) => / ERROR /.test(line));
  expect(errors, `errors in log:\n${errors.join('\n')}`).toEqual([]);
  expect((await readDeck()).mappings).toHaveLength(1);
});
