import { PDFDocument } from 'pdf-lib';
import { useDeckStore } from '../deck';
import { getDeckResources } from '../render';
import { api } from '../shared/api';
import { errorMessage, logger } from '../shared/log';
import { notify } from '../shared/notify';

const safeName = (title: string): string => title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'deck';

/**
 * Backup export: every slide as a PNG, or all slides in one PDF. Animations
 * are drawn in their finished state so the backup deck reads on its own.
 */
export async function exportDeck(kind: 'png' | 'pdf'): Promise<void> {
  const { deck, path } = useDeckStore.getState();
  if (!deck || !path) return;
  const folder = await api().chooseExportFolder();
  if (!folder.ok) {
    notify('error', `Export failed: ${folder.error}`);
    return;
  }
  if (!folder.value) return;

  const { offscreen } = getDeckResources(path);
  const { width, height } = deck.meta.canvas;
  const name = safeName(deck.meta.title);
  const digits = String(deck.slides.length).length;
  notify('info', `Exporting ${deck.slides.length} slide(s)…`);

  try {
    const pdf = kind === 'pdf' ? await PDFDocument.create() : null;
    for (const [i, slide] of deck.slides.entries()) {
      const png = await offscreen.toPng(slide, deck, width);
      if (pdf) {
        const image = await pdf.embedPng(png);
        // 1 slide pixel = 0.5 pt keeps a 1920x1080 slide at a sensible 13.3 x 7.5 inch page.
        const page = pdf.addPage([width / 2, height / 2]);
        page.drawImage(image, { x: 0, y: 0, width: width / 2, height: height / 2 });
      } else {
        const file = `${name}-${String(i + 1).padStart(digits, '0')}.png`;
        const written = await api().writeExportFile(folder.value, file, png);
        if (!written.ok) throw new Error(written.error);
      }
    }
    if (pdf) {
      const written = await api().writeExportFile(folder.value, `${name}.pdf`, await pdf.save());
      if (!written.ok) throw new Error(written.error);
    }
    notify(
      'info',
      kind === 'pdf' ? `Exported ${name}.pdf` : `Exported ${deck.slides.length} PNG file(s).`,
    );
    logger.info('Export finished', { kind, slides: deck.slides.length, folder: folder.value });
  } catch (e) {
    notify('error', `Export failed: ${errorMessage(e)}`);
    logger.error('Export failed', errorMessage(e));
  }
}
