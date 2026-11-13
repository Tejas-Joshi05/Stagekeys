import { PanelBoundary } from '../shared/PanelBoundary';
import { CanvasEditor } from './CanvasEditor';
import { MappingPanel } from './MappingPanel';
import { MidiPanel } from './MidiPanel';
import { NotesPanel } from './NotesPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SlideList } from './SlideList';
import { Toolbar } from './Toolbar';
import { useEditorUi, type RightTab } from './uiStore';

const TABS: { id: RightTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'mappings', label: 'Mappings' },
  { id: 'midi', label: 'MIDI' },
];

/** The editing workspace. Every panel sits in its own error boundary. */
export function Editor({ virtualKeyboard }: { virtualKeyboard: boolean }) {
  const tab = useEditorUi((s) => s.rightTab);
  return (
    <div className="editor" data-testid="editor">
      <PanelBoundary name="Toolbar">
        <Toolbar />
      </PanelBoundary>
      <div className="editor-body">
        <aside className="left">
          <PanelBoundary name="Slides">
            <SlideList />
          </PanelBoundary>
        </aside>
        <main className="centre">
          <PanelBoundary name="Canvas">
            <CanvasEditor />
          </PanelBoundary>
          <PanelBoundary name="Notes">
            <NotesPanel />
          </PanelBoundary>
        </main>
        <aside className="right">
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'on' : ''}
                onClick={() => useEditorUi.setState({ rightTab: t.id })}
                data-testid={`tab-${t.id}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'properties' && (
            <PanelBoundary name="Properties">
              <PropertiesPanel />
            </PanelBoundary>
          )}
          {tab === 'mappings' && (
            <PanelBoundary name="Mappings">
              <MappingPanel />
            </PanelBoundary>
          )}
          {tab === 'midi' && (
            <PanelBoundary name="MIDI">
              <MidiPanel virtualKeyboard={virtualKeyboard} />
            </PanelBoundary>
          )}
        </aside>
      </div>
    </div>
  );
}
