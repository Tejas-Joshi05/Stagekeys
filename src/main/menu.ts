import { Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { CHANNELS } from '../ipc/contract';
import { getLogDir } from './log';
import { getControlWindow, isShowActive } from './windows';

/** Menu items only ever send an Action to the control window; they hold no behaviour of their own. */
function action(
  label: string,
  type: string,
  accelerator?: string,
  extra: Record<string, unknown> = {},
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => {
      const win = getControlWindow();
      if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.menuAction, { type, ...extra });
    },
  };
}

export function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        action('New Deck', 'file.new', 'CmdOrCtrl+N'),
        action('Open…', 'file.open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        action('Save', 'file.save', 'CmdOrCtrl+S'),
        action('Save As…', 'file.saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        action('Export Slides as PNG…', 'file.exportPng'),
        action('Export Slides as PDF…', 'file.exportPdf'),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        action('Undo', 'edit.undo', 'CmdOrCtrl+Z'),
        action('Redo', 'edit.redo', 'CmdOrCtrl+Shift+Z'),
        { type: 'separator' },
        // Native roles fire DOM clipboard events; the renderer turns those into actions
        // when the focus is on the canvas, and leaves text fields alone.
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        action('Duplicate', 'edit.duplicate', 'CmdOrCtrl+D'),
        action('Select All', 'edit.selectAll', 'CmdOrCtrl+A'),
      ],
    },
    {
      label: 'Slide',
      submenu: [
        action('New Slide', 'slide.add', 'CmdOrCtrl+M'),
        action('Duplicate Slide', 'slide.duplicate'),
        action('Delete Slide', 'slide.delete'),
      ],
    },
    {
      label: 'Show',
      submenu: [
        action('Present', 'show.start', 'CmdOrCtrl+Return', { rehearsal: false }),
        action('Rehearse', 'show.start', 'CmdOrCtrl+Shift+Return', { rehearsal: true }),
        action('End Show', 'show.end'),
        { type: 'separator' },
        action('Toggle FPS Overlay', 'view.toggleFps', 'CmdOrCtrl+Shift+F'),
        action('Show or Hide Keys Picture', 'view.toggleKeys', 'CmdOrCtrl+Shift+K'),
        action('Piano Sound On or Off', 'audio.togglePiano', 'CmdOrCtrl+Shift+P'),
        action('Sound Input On or Off', 'audio.toggleInput', 'CmdOrCtrl+Shift+L'),
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Log Folder',
          click: () => {
            if (!isShowActive()) void shell.openPath(getLogDir());
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
