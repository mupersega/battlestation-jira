import { DestroyRef, Directive, ElementRef, HostAttributeToken, inject } from '@angular/core';

/**
 * Tells an element where the pointer is over it, as two numbers from -1 to 1:
 * --px from its left edge to its right, --py from its top to its bottom, and
 * both 0 when the pointer is elsewhere. The styles decide what to do with
 * them: lean the element toward the pointer, slide what is behind its words
 * the other way.
 *
 * appTilt="parent" watches the pointer over the element's parent instead,
 * for something that lies behind everything and is never itself pointed at.
 */
@Directive({ selector: '[appTilt]' })
export class Tilt {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const watched = inject(new HostAttributeToken('appTilt'), { optional: true }) === 'parent' ? (el.parentElement ?? el) : el;
    let frame = 0;
    const set = (x: number, y: number) => {
      el.style.setProperty('--px', x.toFixed(3));
      el.style.setProperty('--py', y.toFixed(3));
    };
    const within = (n: number) => Math.max(-1, Math.min(1, n));
    const move = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const box = watched.getBoundingClientRect();
        if (!box.width || !box.height) return;
        set(within(((e.clientX - box.left) / box.width) * 2 - 1), within(((e.clientY - box.top) / box.height) * 2 - 1));
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      set(0, 0);
    };
    watched.addEventListener('pointermove', move, { passive: true });
    watched.addEventListener('pointerleave', leave, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      watched.removeEventListener('pointermove', move);
      watched.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
    });
  }
}
