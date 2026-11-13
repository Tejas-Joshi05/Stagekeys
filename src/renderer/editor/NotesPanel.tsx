import { getCurrentSlide, setSlideNotes, useDeckStore } from '../deck';

export function NotesPanel() {
  const slide = useDeckStore((s) => getCurrentSlide(s));
  if (!slide) return null;
  return (
    <div className="notes-panel">
      <textarea
        data-testid="notes"
        value={slide.notes}
        placeholder="Speaker notes for this slide. Only you see these, in the presenter view."
        onChange={(e) => setSlideNotes(slide.id, e.target.value)}
      />
    </div>
  );
}
