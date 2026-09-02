import { describe, expect, it } from 'vitest';
import { buildSupabaseCallbackUrl, normalizeAuthDestination } from './supabase';

describe('same-origin Supabase callbacks', () => {
  it('returns admin login to the test wedding origin', () => {
    expect(buildSupabaseCallbackUrl('https://test.eshome.it', '/admin'))
      .toBe('https://test.eshome.it/auth/callback?next=%2Fadmin');
  });

  it('returns admin login to the production wedding origin', () => {
    expect(buildSupabaseCallbackUrl('https://wedding.eshome.it', '/admin'))
      .toBe('https://wedding.eshome.it/auth/callback?next=%2Fadmin');
  });

  it.each(['https://evil.example', '//evil.example', 'javascript:alert(1)'])(
    'rejects unsafe next destination %s',
    (destination) => {
      expect(normalizeAuthDestination(destination, '/admin')).toBe('/admin');
    },
  );
});
