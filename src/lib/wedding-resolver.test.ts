import { describe, expect, it } from 'vitest';
import {
  isFallbackWeddingHost,
  normalizeWeddingHostname,
  selectWeddingResolution,
} from './wedding-resolver';

describe('wedding hostname normalization', () => {
  it.each([
    ['wedding.eshome.it', 'wedding.eshome.it'],
    [' TEST.ESHOME.IT ', 'test.eshome.it'],
    ['wedding.eshome.it:443', 'wedding.eshome.it'],
    ['localhost:5173', 'localhost'],
    ['[::1]', '::1'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeWeddingHostname(input)).toBe(expected);
  });

  it('allows fallback only on known development and workers.dev hosts', () => {
    expect(isFallbackWeddingHost('localhost:5173')).toBe(true);
    expect(isFallbackWeddingHost('127.0.0.1:8787')).toBe(true);
    expect(isFallbackWeddingHost('serena-enrico-wedding.example.workers.dev')).toBe(true);
    expect(isFallbackWeddingHost('foo.eshome.it')).toBe(false);
  });
});

describe('wedding resolution policy', () => {
  it('gives a mapped hostname precedence over the fallback', () => {
    expect(selectWeddingResolution('localhost', { slug: 'mapped' }, { slug: 'fallback' }))
      .toEqual({ source: 'domain', wedding: { slug: 'mapped' } });
  });

  it('uses fallback on localhost and workers.dev', () => {
    expect(selectWeddingResolution('localhost:5173', null, { slug: 'fallback' })?.source)
      .toBe('fallback');
    expect(selectWeddingResolution('worker.example.workers.dev', null, { slug: 'fallback' })?.source)
      .toBe('fallback');
  });

  it('does not resolve an unknown custom hostname', () => {
    expect(selectWeddingResolution('foo.eshome.it', null, { slug: 'fallback' })).toBeNull();
  });
});
