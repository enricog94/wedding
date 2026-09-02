const MEGABYTE = 1024 * 1024;

export const MEDIA_TYPES = {
  'image/jpeg': { extension: 'jpg', maxSize: 20 * MEGABYTE },
  'image/png': { extension: 'png', maxSize: 20 * MEGABYTE },
  'image/webp': { extension: 'webp', maxSize: 20 * MEGABYTE },
  'image/heic': { extension: 'heic', maxSize: 20 * MEGABYTE },
  'image/heif': { extension: 'heif', maxSize: 20 * MEGABYTE },
  'video/mp4': { extension: 'mp4', maxSize: 500 * MEGABYTE },
  'video/quicktime': { extension: 'mov', maxSize: 500 * MEGABYTE },
} as const;

export type SupportedMimeType = keyof typeof MEDIA_TYPES;
export type SupportedImageMimeType = Extract<SupportedMimeType, `image/${string}`>;

export const FANTASPOSI_PROOF_SOURCE = 'fantasposi_proof';

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return Object.prototype.hasOwnProperty.call(MEDIA_TYPES, value) && value.startsWith('image/');
}
