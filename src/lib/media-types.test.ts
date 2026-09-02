import { describe, expect, it } from 'vitest';
import { isPrivateGameMediaSource } from './media-types';

describe('private FantaSposi media sources', () => {
  it.each(['fantasposi_proof', 'fantasposi_avatar'])(
    'keeps %s outside public and moderation media',
    (source) => expect(isPrivateGameMediaSource(source)).toBe(true),
  );

  it.each(['guest', 'photobooth', 'admin'])(
    'keeps normal source %s available to existing media flows',
    (source) => expect(isPrivateGameMediaSource(source)).toBe(false),
  );
});
