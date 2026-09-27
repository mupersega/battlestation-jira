import { TestBed } from '@angular/core/testing';
import { Look } from './core/look';

describe('Look', () => {
  it('applies the theme to the root element', () => {
    const look = TestBed.inject(Look);
    expect(look.themes.map((t) => t.label)).toEqual(['Amber', 'Blue', 'Red', 'Green']);
    look.theme.set('blue');
    TestBed.tick();
    expect(document.documentElement.dataset['theme']).toBe('blue');
  });

  it('applies the face to the root element, starting on Exo 2', () => {
    localStorage.clear();
    const look = TestBed.inject(Look);
    expect(look.fonts[0].label).toBe('Exo 2');
    look.font.set('rajdhani');
    TestBed.tick();
    expect(document.documentElement.dataset['font']).toBe('rajdhani');
  });

  it('applies the texture to the root element, starting on paint', () => {
    localStorage.clear();
    const look = TestBed.inject(Look);
    expect(look.textures.map((x) => x.label)).toEqual(['Paint', 'Metal', 'Hex']);
    look.texture.set('metal');
    TestBed.tick();
    expect(document.documentElement.dataset['texture']).toBe('metal');
  });
});
