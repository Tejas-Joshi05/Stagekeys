import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * An edited deck that was never saved to a file survives quitting as a draft,
 * and deleting that draft asks first.
 */

let work = '';
test.beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'stagekeys-drafts-'));
});
test.afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

function launch(): Promise<ElectronApplication> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  return electron.launch({
    args: ['.'],
    env: { ...env, STAGEKEYS_E2E: '1', STAGEKEYS_USER_DATA: path.join(work, 'profile') },
  });
}

test('a draft survives quitting, and deleting it asks first', async () => {
  let app = await launch();
  let win = await app.firstWindow();
  await win.getByTestId('new-deck').click();
  await win.getByTestId('add-text').click();
  await expect(win.getByTestId('canvas-empty')).toHaveCount(0);
  await app.close();

  app = await launch();
  win = await app.firstWindow();
  await expect(win.getByTestId('drafts')).toBeVisible();
  await expect(win.getByTestId('draft-delete')).toHaveCount(1);

  // Deleting asks first; Cancel and Escape both leave the draft alone.
  await win.getByTestId('draft-delete').click();
  await expect(win.getByTestId('confirm')).toContainText('cannot be undone');
  await win.getByTestId('confirm-cancel').click();
  await expect(win.getByTestId('confirm')).toHaveCount(0);
  await win.getByTestId('draft-delete').click();
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('confirm')).toHaveCount(0);
  await expect(win.getByTestId('draft-delete')).toHaveCount(1);

  await win.getByTestId('draft-delete').click();
  await win.getByTestId('confirm-ok').click();
  await expect(win.getByTestId('drafts')).toHaveCount(0);
  await app.close();
});
