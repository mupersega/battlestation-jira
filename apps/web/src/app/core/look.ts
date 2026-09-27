import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import tokens from '@battlestation/design/tokens.json';

export type ThemeId = keyof typeof tokens.themes;
export type AxisId = keyof typeof tokens.styleAxes;
export type AxisValues = Record<AxisId, string>;
export type FontId = keyof typeof tokens.fonts;
export type TextureId = keyof typeof tokens.textures;

const STORAGE_KEY = 'battlestation.look';

interface Stored {
  theme: ThemeId;
  axes: AxisValues;
  font?: FontId;
  texture?: TextureId;
}

/**
 * The active theme, face, texture and style-mode axes, applied to the root
 * element: one theme at a time, and one class per axis. Remembered per
 * browser.
 */
@Injectable({ providedIn: 'root' })
export class Look {
  private readonly root = inject(DOCUMENT).documentElement;

  readonly themes = Object.entries(tokens.themes).map(([id, t]) => ({ id: id as ThemeId, label: t.label, primary: t.primary }));
  readonly axes = Object.entries(tokens.styleAxes).map(([id, values]) => ({ id: id as AxisId, values: Object.keys(values) }));

  readonly fonts = Object.entries(tokens.fonts).map(([id, f]) => ({ id: id as FontId, label: f.label, family: f.family, note: f.note }));

  readonly textures = Object.entries(tokens.textures).map(([id, x]) => ({ id: id as TextureId, label: x.label, note: x.note }));

  readonly theme = signal<ThemeId>('amber');
  readonly texture = signal<TextureId>('paint');
  readonly font = signal<FontId>('exo-2');
  readonly axisValues = signal<AxisValues>({ ...tokens.styleAxisDefaults });

  constructor() {
    const stored = this.read();
    if (stored) {
      if (stored.theme in tokens.themes) this.theme.set(stored.theme);
      if (stored.font && stored.font in tokens.fonts) this.font.set(stored.font);
      if (stored.texture && stored.texture in tokens.textures) this.texture.set(stored.texture);
      this.axisValues.update((current) => ({ ...current, ...this.validAxes(stored.axes) }));
    }

    // The address can name a look, so that one can be pointed at: ?texture=metal&font=saira&theme=blue
    const asked = new URLSearchParams(this.root.ownerDocument.defaultView?.location.search ?? '');
    const theme = asked.get('theme');
    const font = asked.get('font');
    const texture = asked.get('texture');
    if (theme && theme in tokens.themes) this.theme.set(theme as ThemeId);
    if (font && font in tokens.fonts) this.font.set(font as FontId);
    if (texture && texture in tokens.textures) this.texture.set(texture as TextureId);

    effect(() => {
      const theme = this.theme();
      const axes = this.axisValues();
      const font = this.font();
      this.root.dataset['theme'] = theme;
      const texture = this.texture();
      this.root.dataset['font'] = font;
      this.root.dataset['texture'] = texture;
      for (const axis of this.axes) {
        for (const value of axis.values) this.root.classList.toggle(`${axis.id}-${value}`, axes[axis.id] === value);
      }
      this.write({ theme, axes, font, texture });
    });
  }

  setAxis(axis: AxisId, value: string): void {
    this.axisValues.update((current) => ({ ...current, [axis]: value }));
  }

  reset(): void {
    this.theme.set('amber');
    this.font.set('exo-2');
    this.texture.set('paint');
    this.axisValues.set({ ...tokens.styleAxisDefaults });
  }

  private validAxes(axes: Partial<AxisValues> | undefined): Partial<AxisValues> {
    const out: Partial<AxisValues> = {};
    for (const axis of this.axes) {
      const value = axes?.[axis.id];
      if (value && axis.values.includes(value)) out[axis.id] = value;
    }
    return out;
  }

  private read(): Stored | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      return null;
    }
  }

  private write(value: Stored): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Private window or blocked storage: the look simply is not remembered.
    }
  }
}
