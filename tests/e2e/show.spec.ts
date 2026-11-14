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

  // Slides 2-6: the other animations plus ordinary elements.
  for (const id of [
    'ascii-garden',
    'pressed-bloom',
    'ripple',
    'text-reveal',
    'step-sequence',
    'ascii-vignette',
    'midi-readout',
    'note-trails',
    'glyph-burst',
  ]) {
    await win.getByTestId('add-slide').click();
    await win.getByTestId('add-animation').selectOption(id);
    await win.getByTestId('add-rect').click();
    await win.getByTestId('add-text').click();
  }
  await win.getByTestId('add-animation').selectOption('pulse');
  await expect(win.getByTestId('slide-thumb')).toHaveCount(10);

  // The last animation follows the sound input through a binding.
  await win.getByTestId('add-binding').click();
  await win
    .getByTestId('binding')
    .last()
    .getByLabel('Driven by')
    .selectOption({ label: 'Sound: loudness' });
  await expect(win.getByTestId('bound-note')).toContainText('sound: loudness');

  // A planned length for the talk, for the countdown in the presenter view.
  await win.getByTestId('talk-length').fill('20');

  // Every slide arrives through an ASCII transition, so the stress run below hammers those too.
  await win.keyboard.press('Escape');
  await win.getByTestId('slide-thumb').nth(1).click();
  await win.getByTestId('transition-kind').selectOption('ascii-dissolve');
  await win.getByTestId('transition-everywhere').click();
  await win.getByTestId('slide-thumb').nth(2).click();
  await expect(win.getByTestId('transition-kind')).toHaveValue('ascii-dissolve');
  await win.getByTestId('transition-kind').selectOption('ascii-rain');
  await win.getByTestId('slide-thumb').nth(3).click();
  await win.getByTestId('transition-kind').selectOption('slide-up');

  // A chord, learned by holding three keys: C4 + E4 + G4 goes to the next slide.
  await win.getByTestId('tab-mappings').click();
  await win.getByTestId('map-chord').click();
  await expect(win.getByTestId('chord-listening')).toBeVisible();
  await win.evaluate(() => {
    const midi = window.__stagekeysMidi;
    for (const note of [60, 64, 67]) midi?.([0x90, note, 100]);
  });
  await expect(win.getByTestId('chord-listening')).toContainText('C4 E4 G4');
  await win.evaluate(() => {
    const midi = window.__stagekeysMidi;
    for (const note of [60, 64, 67]) midi?.([0x80, note, 0]);
  });
  await expect(win.getByTestId('mapping-input')).toHaveText('Chord C4 + E4 + G4');
  await expect(win.getByTestId('chord-notes')).toHaveValue('C4 E4 G4');
  await win.getByTestId('tab-properties').click();

  await win.getByTestId('save').click();
  await expect(win.getByTestId('save-status')).toHaveText('Saved');

  // ── Rehearse and hammer it ────────────────────────────────────────────────
  await win.getByTestId('slide-thumb').first().click();
  const stagePromise = app.waitForEvent('window');
  await win.getByTestId('rehearse').click();
  const stage = await stagePromise;
  await stage.waitForFunction(() => window.__stagekeysStage !== undefined);

  // The presenter view: a countdown to the planned length, and what the keys do on this slide.
  await expect(win.getByTestId('presenter-countdown')).toContainText('left');
  await expect(win.getByTestId('cheat-sheet')).toContainText('How hard you play');
  await expect(win.getByTestId('cheat-sheet')).toContainText('Size of Bloom');
  // The deck has a sound-reactive slide and sound input is off: said once, quietly.
  await expect(win.getByTestId('notice').filter({ hasText: 'sound input is off' })).toBeVisible();
  // No stepped animation on this slide, so no reveal counter.
  await expect(win.getByTestId('presenter-steps')).toHaveCount(0);

  // Sound input switches on from the stage keyboard; the test feeds it levels.
  await stage.keyboard.press('l');
  await expect(win.getByTestId('presenter-sound')).toHaveAttribute('aria-pressed', 'true');
  await stage.evaluate(() =>
    window.__stagekeysAudio?.({ level: 0.2, bass: 0.2, mid: 0.1, treble: 0.05 }),
  );
  await expect
    .poll(() => stage.evaluate(() => window.__stagekeysStage?.sound() ?? 0))
    .toBeGreaterThan(0.5);

  // 400 rounds of notes, knob moves, sound and slide changes, as fast as they will go.
  await stage.evaluate(async () => {
    const midi = window.__stagekeysMidi;
    const audio = window.__stagekeysAudio;
    if (!midi || !audio) throw new Error('no midi or audio hook');
    const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    for (let i = 0; i < 400; i++) {
      midi([0x90, 36 + (i % 60), 1 + ((i * 7) % 127)]);
      midi([0xb0, 1, i % 128]);
      midi([0xe0, 0, i % 128]);
      midi([0x80, 36 + (i % 60), 0]);
      const loud = (i % 16) / 16;
      audio({ level: loud, bass: loud * loud, mid: 1 - loud, treble: i % 3 === 0 ? loud : 0 });
      if (i % 5 === 0) key(i % 40 < 20 ? 'ArrowRight' : 'ArrowLeft');
      if (i % 97 === 0) key('h');
      if (i % 10 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await expect
    .poll(() => stage.evaluate(() => window.__stagekeysStage?.fps() ?? 0), { timeout: 10_000 })
    .toBeGreaterThan(30);

  // The chord goes to the next slide; two of its three keys do not.
  await stage.keyboard.press('Home');
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(0);
  await stage.evaluate(() => {
    const midi = window.__stagekeysMidi;
    midi?.([0x90, 60, 100]);
    midi?.([0x90, 64, 100]);
  });
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(0);
  await stage.evaluate(() => window.__stagekeysMidi?.([0x90, 67, 100]));
  await expect.poll(() => stage.evaluate(() => window.__stagekeysStage?.slideIndex())).toBe(1);
  await stage.evaluate(() => {
    const midi = window.__stagekeysMidi;
    for (const note of [60, 64, 67]) midi?.([0x80, note, 0]);
  });

  // Slide 5 is a text reveal: the presenter view counts the key presses left.
  await stage.keyboard.press('Home');
  for (let i = 0; i < 4; i++) await stage.keyboard.press('ArrowRight');
  await expect(win.getByTestId('presenter-steps')).toHaveText('revealed 0 of 3');
  await stage.evaluate(() => window.__stagekeysMidi?.([0x90, 60, 100]));
  await expect(win.getByTestId('presenter-steps')).toHaveText('revealed 1 of 3');
  await stage.evaluate(() => {
    window.__stagekeysMidi?.([0x90, 62, 100]);
    window.__stagekeysMidi?.([0x90, 64, 100]);
  });
  await expect(win.getByTestId('presenter-steps')).toHaveText('all 3 revealed');
  await win.getByTestId('notes-bigger').click();
  await expect(win.getByTestId('presenter-notes')).toHaveCSS('font-size', '28px');

  // Piano and the keys picture switch on from the stage keyboard and are remembered.
  await stage.keyboard.press('p');
  await stage.keyboard.press('k');
  await expect(win.getByTestId('presenter-keys')).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('.stage-keys')).toBeVisible();
  await stage.evaluate(() => {
    const midi = window.__stagekeysMidi;
    for (let i = 0; i < 40; i++) midi?.([0x90, 48 + (i % 25), 90]);
    for (let i = 0; i < 40; i++) midi?.([0x80, 48 + (i % 25), 0]);
  });
  const settings = JSON.parse(await readFile(path.join(work, 'profile', 'settings.json'), 'utf8'));
  expect(settings.piano.enabled).toBe(true);
  expect(settings.keysOverlay.stage).toBe(true);
  expect(settings.audioInput.enabled).toBe(true);

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
    .toBe(10);
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
