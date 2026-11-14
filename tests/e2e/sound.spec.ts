import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Sound input through the real capture path: getUserMedia, the analyser and
 * the level follower, fed by Chromium's fake microphone (a beeping tone). The
 * machine's own microphone is never opened and no system prompt appears.
 */

let work = '';
test.beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'stagekeys-sound-'));
});
test.afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/**
 * The fake microphone beeps briefly about once a second, so the level is
 * watched closely rather than sampled now and then.
 */
const WATCH = { timeout: 15_000, polling: 30 };
const editorHears = (win: Page): Promise<unknown> =>
  win.waitForFunction(() => (window.__stagekeysSound?.() ?? 0) > 0.05, null, WATCH);
const stageHears = (stage: Page): Promise<unknown> =>
  stage.waitForFunction(() => (window.__stagekeysStage?.sound() ?? 0) > 0.05, null, WATCH);

test('sound input hears a device in the editor and hands it to the stage for a show', async () => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...env,
      STAGEKEYS_E2E: '1',
      STAGEKEYS_E2E_FAKE_MIC: '1',
      STAGEKEYS_USER_DATA: path.join(work, 'profile'),
    },
  });
  const win = await app.firstWindow();
  await win.getByTestId('new-deck').click();
  await expect(win.getByTestId('editor')).toBeVisible();
  await win.getByTestId('add-animation').selectOption('ascii-vignette');

  // Off until asked for.
  await win.getByRole('button', { name: 'MIDI & sound' }).click();
  await expect(win.getByTestId('audio-input-status')).toHaveText('Off');
  expect(await win.evaluate(() => window.__stagekeysSound?.())).toBe(0);

  // On: the device opens and its sound arrives.
  await win.getByTestId('audio-input-toggle').locator('input').check();
  await expect(win.getByTestId('audio-input-status')).toHaveText('Listening');
  await editorHears(win);

  // The slider runs the whole range, and changing it must not switch the input off
  // (a settings change once reset the rest of its group to defaults).
  await win.getByTestId('audio-sensitivity').fill('0');
  await expect(win.getByTestId('audio-sensitivity-word')).toHaveText('as stiff as it gets');
  await win.waitForTimeout(600);
  await expect(win.getByTestId('audio-input-status')).toHaveText('Listening');
  await expect(win.getByTestId('audio-input-toggle').locator('input')).toBeChecked();
  await win.getByTestId('audio-sensitivity').fill('1');
  await expect(win.getByTestId('audio-sensitivity-word')).toHaveText('as sensitive as it gets');

  // A show: the stage takes over listening, the editor lets go.
  const stagePromise = app.waitForEvent('window');
  await win.getByTestId('rehearse').click();
  const stage = await stagePromise;
  await stage.waitForFunction(() => window.__stagekeysStage !== undefined);
  await stageHears(stage);
  expect(await win.evaluate(() => window.__stagekeysSound?.())).toBe(0);
  await expect(win.getByTestId('presenter-sound')).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByTestId('presenter-sound-status')).toHaveCount(0);

  const closed = stage.waitForEvent('close');
  await stage.keyboard.press('Escape').catch(() => undefined);
  await closed;

  // Back in the editor, it listens again.
  await expect(win.getByTestId('editor')).toBeVisible();
  await editorHears(win);

  await app.close();
  const settings = JSON.parse(await readFile(path.join(work, 'profile', 'settings.json'), 'utf8'));
  expect(settings.audioInput).toMatchObject({ enabled: true, sensitivity: 1 });
  const log = await readFile(path.join(work, 'profile', 'logs', 'stagekeys.log'), 'utf8');
  const problems = log.split('\n').filter((line) => / (ERROR|WARN) /.test(line));
  expect(problems, `problems in log:\n${problems.join('\n')}`).toEqual([]);
});
