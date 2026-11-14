import { describe, expect, it, vi } from 'vitest';
import { ActionDispatcher } from './dispatcher';
import { actionForKey, type KeyLike } from './shortcuts';
import { ActionSchema } from './types';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('ActionDispatcher', () => {
  it('routes an action to every handler registered for its type', () => {
    const d = new ActionDispatcher(() => 0);
    const a = vi.fn();
    const b = vi.fn();
    d.register('nav.next', a);
    d.register('nav.next', b);
    d.register('nav.prev', vi.fn());
    expect(d.dispatch({ type: 'nav.next' }, 'ui')).toBe(true);
    expect(a).toHaveBeenCalledWith({ type: 'nav.next' }, 'ui');
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns false when nothing handles the action', () => {
    const d = new ActionDispatcher(() => 0);
    expect(d.dispatch({ type: 'show.panic' }, 'midi')).toBe(false);
  });

  it('never throws; a failing handler is reported and the others still run', () => {
    const d = new ActionDispatcher(() => 0);
    const sink = vi.fn();
    const after = vi.fn();
    d.setErrorSink(sink);
    d.register('nav.next', () => {
      throw new Error('boom');
    });
    d.register('nav.next', after);
    expect(() => d.dispatch({ type: 'nav.next' }, 'midi')).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('stops calling a handler once it is unregistered', () => {
    const d = new ActionDispatcher(() => 0);
    const h = vi.fn();
    const off = d.register('edit.undo', h);
    off();
    d.dispatch({ type: 'edit.undo' }, 'ui');
    expect(h).not.toHaveBeenCalled();
  });

  it('ignores the duplicate when a menu accelerator and keydown both fire', () => {
    let t = 0;
    const d = new ActionDispatcher(() => t);
    const h = vi.fn();
    d.register('edit.undo', h);
    d.dispatch({ type: 'edit.undo' }, 'menu');
    t = 5;
    d.dispatch({ type: 'edit.undo' }, 'keyboard');
    expect(h).toHaveBeenCalledTimes(1);
    t = 500;
    d.dispatch({ type: 'edit.undo' }, 'keyboard');
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('does not treat rapid repeats from one source as duplicates', () => {
    const d = new ActionDispatcher(() => 0);
    const h = vi.fn();
    d.register('nav.next', h);
    d.dispatch({ type: 'nav.next' }, 'midi');
    d.dispatch({ type: 'nav.next' }, 'midi');
    expect(h).toHaveBeenCalledTimes(2);
  });

  it('lets observers see every action', () => {
    const d = new ActionDispatcher(() => 0);
    const seen = vi.fn();
    d.observe(seen);
    d.dispatch({ type: 'show.blackToggle' }, 'keyboard');
    expect(seen).toHaveBeenCalledWith({ type: 'show.blackToggle' }, 'keyboard');
  });
});

describe('ActionSchema', () => {
  it('accepts valid actions and rejects malformed ones', () => {
    expect(ActionSchema.safeParse({ type: 'nav.goto', index: 3 }).success).toBe(true);
    expect(ActionSchema.safeParse({ type: 'nav.goto', index: -1 }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'nope' }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: 'anim.trigger', elementId: 'e', value: 2 }).success).toBe(
      false,
    );
  });
});

describe('keyboard shortcuts', () => {
  it('provides the show fallback keys', () => {
    expect(actionForKey(key('ArrowRight'), 'show')).toEqual({ type: 'nav.next' });
    expect(actionForKey(key(' '), 'show')).toEqual({ type: 'nav.next' });
    expect(actionForKey(key('ArrowLeft'), 'show')).toEqual({ type: 'nav.prev' });
    expect(actionForKey(key('Escape'), 'show')).toEqual({ type: 'show.end' });
    expect(actionForKey(key('b'), 'show')).toEqual({ type: 'show.blackToggle' });
    expect(actionForKey(key('h'), 'show')).toEqual({ type: 'show.panic' });
    expect(actionForKey(key('k'), 'show')).toEqual({ type: 'view.toggleKeys' });
    expect(actionForKey(key('p'), 'show')).toEqual({ type: 'audio.togglePiano' });
    expect(actionForKey(key('l'), 'show')).toEqual({ type: 'audio.toggleInput' });
  });

  it('toggles the piano and keys picture with shift-command in the editor', () => {
    expect(actionForKey(key('P', { metaKey: true, shiftKey: true }), 'editor')).toEqual({
      type: 'audio.togglePiano',
    });
    expect(actionForKey(key('K', { metaKey: true, shiftKey: true }), 'editor')).toEqual({
      type: 'view.toggleKeys',
    });
    expect(actionForKey(key('p'), 'editor')).toBeNull();
  });

  it('maps standard editor shortcuts', () => {
    expect(actionForKey(key('z', { metaKey: true }), 'editor')).toEqual({ type: 'edit.undo' });
    expect(actionForKey(key('Z', { metaKey: true, shiftKey: true }), 'editor')).toEqual({
      type: 'edit.redo',
    });
    expect(actionForKey(key('d', { ctrlKey: true }), 'editor')).toEqual({ type: 'edit.duplicate' });
    expect(actionForKey(key('Delete'), 'editor')).toEqual({ type: 'edit.delete' });
    expect(actionForKey(key('ArrowUp', { shiftKey: true }), 'editor')).toEqual({
      type: 'edit.nudge',
      dx: 0,
      dy: -10,
    });
  });

  it('returns null for unmapped keys', () => {
    expect(actionForKey(key('q'), 'editor')).toBeNull();
    expect(actionForKey(key('q'), 'show')).toBeNull();
  });
});
