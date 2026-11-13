import { useDeckStore } from '../deck';
import { Editor } from '../editor';
import { PresenterView, RehearsalReport, usePresenterStore } from '../presenter';
import { PanelBoundary } from '../shared/PanelBoundary';
import { useAppStore } from './appStore';
import { Notices } from './Notices';
import { OpenErrorModal, Welcome } from './Welcome';

export function App() {
  const hasDeck = useDeckStore((s) => s.deck !== null);
  const presenting = usePresenterStore((s) => s.active);
  const info = useAppStore((s) => s.info);
  const virtualKeyboard = info !== null && (info.isDev || info.e2e);

  return (
    <>
      {presenting ? (
        <PanelBoundary name="Presenter view">
          <PresenterView />
        </PanelBoundary>
      ) : hasDeck ? (
        <Editor virtualKeyboard={virtualKeyboard} />
      ) : (
        <PanelBoundary name="Welcome">
          <Welcome />
        </PanelBoundary>
      )}
      <RehearsalReport />
      <OpenErrorModal />
      <Notices />
    </>
  );
}
