import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The symbols. One per kind of thing, used everywhere that kind appears, so
 * that what something is can be read before its words are.
 */
export type IconName = 'issue' | 'epic' | 'sprint' | 'task' | 'event' | 'board' | 'backlog' | 'inbox' | 'hand' | 'alert';

interface Glyph {
  paths: string[];
  /** Drawn solid rather than in outline. */
  solid?: boolean;
}

const GLYPHS: Record<IconName, Glyph> = {
  issue: { paths: ['M3 2.5h10v11H3z', 'M5.5 6h5', 'M5.5 8.5h5', 'M5.5 11h3'] },
  epic: { paths: ['M8 1.8l6 3.2-6 3.2-6-3.2z', 'M2 8l6 3.2L14 8', 'M2 11l6 3.2 6-3.2'] },
  sprint: { paths: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.5 2.5v3h-3'] },
  task: { paths: ['M4 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z', 'M5.2 8.2l2 2L10.9 6'] },
  event: { paths: ['M3.5 3h9A1.5 1.5 0 0 1 14 4.5v8A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3z', 'M2 6.5h12', 'M5 1.5v3', 'M11 1.5v3'] },
  board: { paths: ['M2.5 2.5h4.5v4.5H2.5z', 'M9 2.5h4.5v4.5H9z', 'M2.5 9h4.5v4.5H2.5z', 'M9 9h4.5v4.5H9z'] },
  backlog: { paths: ['M2.5 4h11', 'M4.5 8h7', 'M6.5 12h3'] },
  inbox: { paths: ['M2 9.5l2-6.5h8l2 6.5v4H2z', 'M2 9.5h3.5l1 2h3l1-2H14'] },
  hand: { paths: ['M9 1.5L3.5 9h4l-1 5.5L12.5 7h-4z'] },
  alert: { paths: ['M8 2l6.5 11.5h-13z', 'M8 6.5v3.2', 'M8 11.6v.4'] },
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
      @for (d of glyph().paths; track $index) {
        <path
          [attr.d]="d"
          [attr.fill]="glyph().solid ? 'currentColor' : 'none'"
          [attr.stroke]="glyph().solid ? 'none' : 'currentColor'"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly glyph = computed(() => GLYPHS[this.name()]);
}
