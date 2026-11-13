import { actions } from '../actions';
import {
  addSlide,
  deleteElements,
  deleteSlide,
  duplicateElements,
  duplicateSlide,
  getCurrentSlide,
  getCurrentSlideIndex,
  newDeck,
  openDeckWithDialog,
  orderElements,
  redo,
  saveDeck,
  saveDeckAs,
  setCurrentSlide,
  setSelection,
  undo,
  updateElements,
  useDeckStore,
  type OpenResult,
} from '../deck';
import {
  copySelection,
  cutSelection,
  exportDeck,
  insertElement,
  pasteClipboard,
  previewSetParam,
  previewTrigger,
  useEditorUi,
} from '../editor';
import { sendToStage, startShow, usePresenterStore } from '../presenter';
import { useAppStore } from './appStore';

const showing = (): boolean => usePresenterStore.getState().active;

export function reportOpenResult(result: OpenResult | null): void {
  if (!result) return;
  useAppStore.setState({
    openError: result.ok
      ? null
      : { error: result.error, path: result.path, backups: result.backups },
  });
}

function gotoIndex(index: number): void {
  const deck = useDeckStore.getState().deck;
  const slide = deck?.slides[Math.min(deck.slides.length - 1, Math.max(0, index))];
  if (slide) setCurrentSlide(slide.id);
}

/**
 * Action handlers for the control window. While a show is running, show
 * actions are forwarded to the stage window; otherwise they act on the editor.
 */
export function registerControlActions(): void {
  // Navigation
  actions.register('nav.next', (a, source) => {
    if (showing()) sendToStage(a, source === 'keyboard' ? 'keyboard' : 'ui');
    else gotoIndex(getCurrentSlideIndex() + 1);
  });
  actions.register('nav.prev', (a, source) => {
    if (showing()) sendToStage(a, source === 'keyboard' ? 'keyboard' : 'ui');
    else gotoIndex(getCurrentSlideIndex() - 1);
  });
  actions.register('nav.goto', (a, source) => {
    if (showing()) sendToStage(a, source === 'keyboard' ? 'keyboard' : 'ui');
    else gotoIndex(a.index);
  });
  actions.register('nav.gotoNamed', (a, source) => {
    if (showing()) sendToStage(a, source === 'keyboard' ? 'keyboard' : 'ui');
    else setCurrentSlide(a.slideId);
  });

  // Show
  actions.register('show.start', (a) => {
    if (useDeckStore.getState().deck) void startShow(a.rehearsal);
  });
  for (const type of ['show.end', 'show.blackToggle', 'show.panic'] as const) {
    actions.register(type, (a, source) => {
      if (showing()) sendToStage(a, source === 'keyboard' ? 'keyboard' : 'ui');
    });
  }

  // Animations: forwarded during a show, previewed on the editor canvas otherwise.
  actions.register('anim.trigger', (a) => {
    if (showing()) sendToStage(a, 'ui');
    else previewTrigger(a.elementId, a.value ?? 1);
  });
  actions.register('anim.setParam', (a) => {
    if (showing()) sendToStage(a, 'ui');
    else previewSetParam(a.elementId, a.param, a.value);
  });

  // Editing (ignored while presenting, so a stray shortcut cannot change the deck mid-show)
  const editing =
    <A>(handler: (a: A) => void) =>
    (a: A) => {
      if (!showing() && useDeckStore.getState().deck) handler(a);
    };
  const selection = (): string[] => useDeckStore.getState().selection;

  actions.register(
    'edit.undo',
    editing(() => void undo()),
  );
  actions.register(
    'edit.redo',
    editing(() => void redo()),
  );
  actions.register(
    'edit.copy',
    editing(() => void copySelection()),
  );
  actions.register('edit.cut', editing(cutSelection));
  actions.register('edit.paste', editing(pasteClipboard));
  actions.register(
    'edit.duplicate',
    editing(() => duplicateElements(selection())),
  );
  actions.register(
    'edit.delete',
    editing(() => deleteElements(selection())),
  );
  actions.register(
    'edit.deselect',
    editing(() => setSelection([])),
  );
  actions.register(
    'edit.selectAll',
    editing(() => {
      const slide = getCurrentSlide();
      if (slide)
        setSelection(slide.elements.filter((e) => !e.locked && !e.hidden).map((e) => e.id));
    }),
  );
  actions.register(
    'edit.nudge',
    editing((a) => {
      const ids = selection();
      updateElements(
        ids,
        (el) => {
          if (el.locked) return;
          el.x += a.dx;
          el.y += a.dy;
        },
        { label: 'Nudge', coalesceKey: `nudge:${ids.join(',')}` },
      );
    }),
  );
  actions.register(
    'edit.order',
    editing((a) => orderElements(selection(), a.to)),
  );
  actions.register(
    'element.add',
    editing((a) => void insertElement(a.kind, a.animationId)),
  );

  // Slides
  actions.register('slide.add', editing(addSlide));
  actions.register(
    'slide.duplicate',
    editing(() => {
      const id = useDeckStore.getState().currentSlideId;
      if (id) duplicateSlide(id);
    }),
  );
  actions.register(
    'slide.delete',
    editing(() => {
      const id = useDeckStore.getState().currentSlideId;
      if (id) deleteSlide(id);
    }),
  );

  // Files (not available mid-show: nothing may open a dialog then)
  const whenIdle = (handler: () => void) => () => {
    if (!showing()) handler();
  };
  actions.register(
    'file.new',
    whenIdle(() => void newDeck().then(reportOpenResult)),
  );
  actions.register(
    'file.open',
    whenIdle(() => void openDeckWithDialog().then(reportOpenResult)),
  );
  actions.register(
    'file.save',
    whenIdle(() => void saveDeck()),
  );
  actions.register(
    'file.saveAs',
    whenIdle(() => void saveDeckAs()),
  );
  actions.register(
    'file.exportPng',
    whenIdle(() => void exportDeck('png')),
  );
  actions.register(
    'file.exportPdf',
    whenIdle(() => void exportDeck('pdf')),
  );

  // View
  actions.register('view.toggleFps', (a) => {
    if (showing()) sendToStage(a, 'ui');
    else useEditorUi.setState((s) => ({ fpsVisible: !s.fpsVisible }));
  });
}
