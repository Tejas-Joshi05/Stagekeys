import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Animations, a stress run of the show, rehearsal timings and the PNG/PDF
 * backup export, all against the built app.
 */

let work = '';
test.beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'stagekeys-show-'));
});
test.afterAll(async () => {
  if (process.env.STAGEKEYS_KEEP) console.warn(`kept ${work}`);
  else await rm(work, { recursive: true, force: true });
});

test('animations play, the show survives a stress run, and export works', async () => {
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
      STAGEKEYS_E2E_SAVE_PATH: path.join(work, 'Show.stagekeys'),
      STAGEKEYS_E2E_EXPORT_DIR: path.join(work, 'export'),
    },
  });
  const win = await app.firstWindow();
  await win.getByTestId('new-deck').click();
  await expect(win.getByTestId('editor')).toBeVisible();

  // Slide 1: a Bloom, which starts with velocity bound to its size.
  await win.getByTestId('add-animation').selectOption('bloom');
  await expect(win.getByTestId('binding')).toHaveCount(1);
  await win.getByTestId('anim-test').click();
  await win.evaluate(() => window.__stagekeysMidi?.([0x90, 64, 120]));

  // Slides 2-4: the other animations plus ordinary elements.
  for (const id of ['ripple', 'text-reveal', 'step-sequence']) {
    await win.getByTestId('add-slide').click();
    await win.getByTestId('add-animation').selectOption(id);
    await win.getByTestId('add-rect').click();
    await win.getByTestId('add-text').click();
  }
  await win.getByTestId('add-animation').selectOption('pulse');
  await expect(win.getByTestId('slide-thumb')).toHaveCount(4);

  await win.getByTestId('save').click();
  await expect(win.getByTestId('save-status')).toHaveText('Saved');

  // ── Rehearse and hammer it ────────────────────────────────────────────────
  await win.getByTestId('slide-thumb').first().click();
  const stagePromise = app.waitForEvent('window');
  await win.getByTestId('rehearse').click();
  const stage = await stagePromise;
  await stage.waitForFunction(() => window.__stagekeysStage !== undefined);

  // 400 rounds of notes, knob moves and slide changes, as fast as they will go.
  await stage.evaluate(async () => {
    const midi = window.__stagekeysMidi;
    if (!midi) throw new Error('no midi hook');
    const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    for (let i = 0; i < 400; i++) {
      midi([0x90, 36 + (i % 60), 1 + ((i * 7) % 127)]);
      midi([0xb0, 1, i % 128]);
      midi([0xe0, 0, i % 128]);
      midi([0x80, 36 + (i % 60), 0]);
      if (i % 5 === 0) key(i % 40 < 20 ? 'ArrowRight' : 'ArrowLeft');
      if (i % 97 === 0) key('h');
      if (i % 10 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await expect
    .poll(() => stage.evaluate(() => window.__stagekeysStage?.fps() ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(30);

  const closed = stage.waitForEvent('close');
  // The window closes while the key press is still being acknowledged, so the call itself may reject.
  await stage.keyboard.press('Escape').catch(() => undefined);
  await closed;

  // Rehearsal mode reports per-slide timings afterwards.
  await expect(win.getByTestId('rehearsal-report')).toBeVisible();
  await win.getByTestId('rehearsal-report').getByRole('button', { name: 'Close' }).click();
  await expect(win.getByTestId('editor')).toBeVisible();

  // ── Backup export ─────────────────────────────────────────────────────────
  const menuAction = (type: string) =>
    app.evaluate(({ BrowserWindow }, t) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:action', { type: t });
    }, type);
  const exportDir = path.join(work, 'export');
  await menuAction('file.exportPng');
  await expect
    .poll(
      async () =>
        (await readdir(exportDir).catch(() => [])).filter((f) => f.endsWith('.png')).length,
    )
    .toBe(4);
  await menuAction('file.exportPdf');
  await expect
    .poll(async () => (await readdir(exportDir).catch(() => [])).some((f) => f.endsWith('.pdf')))
    .toBe(true);
  const files = await readdir(exportDir);
  for (const file of files)
    expect((await stat(path.join(exportDir, file))).size).toBeGreaterThan(1000);

  await app.close();

  const log = await readFile(path.join(work, 'profile', 'logs', 'stagekeys.log'), 'utf8');
  const errors = log.split('\n').filter((line) => / ERROR /.test(line));
  expect(errors, `errors in log:\n${errors.join('\n')}`).toEqual([]);
  expect(log).toContain('Rehearsal timings');
});
