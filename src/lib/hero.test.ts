import { describe, expect, it } from 'vitest';
import { weddingHeroImage } from './hero';

describe('wedding hero image', () => {
  it('uses only the image configured on the current wedding', () => {
    expect(weddingHeroImage({
      brideName: 'Serena',
      groomName: 'Enrico',
      heroPhoto: { id: 10, thumbnailUrl: '/a/thumb', previewUrl: '/a/preview' },
    })).toEqual({ src: '/a/preview', alt: 'Serena e Enrico' });
  });

  it('returns a generic no-photo presentation when the wedding has no hero', () => {
    expect(weddingHeroImage({
      brideName: 'Test Sposa',
      groomName: 'Test Sposo',
      heroPhoto: null,
    })).toBeNull();
  });

  it('does not reuse another wedding image as a fallback', () => {
    const weddingA = weddingHeroImage({
      brideName: 'Sposa A',
      groomName: 'Sposo A',
      heroPhoto: { id: 1, thumbnailUrl: '/wedding-a/thumb', previewUrl: '/wedding-a/preview' },
    });
    const weddingB = weddingHeroImage({
      brideName: 'Sposa B',
      groomName: 'Sposo B',
      heroPhoto: null,
    });
    expect(weddingA?.src).toBe('/wedding-a/preview');
    expect(weddingB).toBeNull();
  });
});
