import { useState } from 'react';
import { dispatch } from '../actions';
import {
  moveSlide,
  renameSlide,
  setCurrentSlide,
  useDeckStore,
  type Deck,
  type Slide,
} from '../deck';
import { useSlideImage } from '../render';

interface ThumbProps {
  slide: Slide;
  index: number;
  deck: Deck;
  path: string | null;
  selected: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

function SlideThumb({
  slide,
  index,
  deck,
  path,
  selected,
  dropBefore,
  onDragStart,
  onDragOver,
  onDrop,
}: ThumbProps) {
  const image = useSlideImage(slide, deck, path, 320);
  const [renaming, setRenaming] = useState(false);
  const aspect = `${deck.meta.canvas.width} / ${deck.meta.canvas.height}`;

  return (
    <div
      className={`thumb${selected ? ' selected' : ''}${dropBefore ? ' drop-before' : ''}`}
      data-testid="slide-thumb"
      draggable={!renaming}
      onClick={() => setCurrentSlide(slide.id)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <span className="thumb-number">{index + 1}</span>
      <div className="thumb-body">
        <div
          className="thumb-image"
          style={{ aspectRatio: aspect, background: slide.background.color }}
        >
          {image && <img src={image} alt="" draggable={false} />}
        </div>
        {renaming ? (
          <input
            className="thumb-name-input"
            autoFocus
            defaultValue={slide.name}
            placeholder="Slide name"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              renameSlide(slide.id, e.currentTarget.value.trim());
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        ) : (
          <div
            className="thumb-name"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            {slide.name || <span className="muted">Untitled slide</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Slide sidebar: thumbnails, drag to reorder, double-click a name to rename. */
export function SlideList() {
  const deck = useDeckStore((s) => s.deck);
  const path = useDeckStore((s) => s.path);
  const currentSlideId = useDeckStore((s) => s.currentSlideId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  if (!deck) return null;

  const drop = (index: number): void => {
    if (dragId) {
      const from = deck.slides.findIndex((s) => s.id === dragId);
      // Dropping "before index" after removing the dragged slide shifts later targets by one.
      moveSlide(dragId, from < index ? index - 1 : index);
    }
    setDragId(null);
    setOverIndex(null);
  };

  return (
    <div className="slide-list" data-testid="slide-list">
      <div
        className="thumbs"
        onDragEnd={() => {
          setDragId(null);
          setOverIndex(null);
        }}
      >
        {deck.slides.map((slide, index) => (
          <SlideThumb
            key={slide.id}
            slide={slide}
            index={index}
            deck={deck}
            path={path}
            selected={slide.id === currentSlideId}
            dropBefore={dragId !== null && overIndex === index}
            onDragStart={() => setDragId(slide.id)}
            onDragOver={() => setOverIndex(index)}
            onDrop={() => drop(index)}
          />
        ))}
        <div
          className={`thumb-end${dragId !== null && overIndex === deck.slides.length ? ' drop-before' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOverIndex(deck.slides.length);
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(deck.slides.length);
          }}
        />
      </div>
      <div className="slide-list-actions">
        <button
          onClick={() => dispatch({ type: 'slide.add' }, 'ui')}
          data-testid="add-slide"
          title="New slide"
        >
          + Slide
        </button>
        <button onClick={() => dispatch({ type: 'slide.duplicate' }, 'ui')} title="Duplicate slide">
          Duplicate
        </button>
        <button
          onClick={() => dispatch({ type: 'slide.delete' }, 'ui')}
          disabled={deck.slides.length <= 1}
          title="Delete slide"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
