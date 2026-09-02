import type { PublicContentPhoto, Wedding } from './config';

export type WeddingHeroImage = {
  src: string;
  alt: string;
};

export function weddingHeroImage(
  wedding: Pick<Wedding, 'brideName' | 'groomName' | 'heroPhoto'>,
): WeddingHeroImage | null {
  const photo: PublicContentPhoto | null | undefined = wedding.heroPhoto;
  if (!photo?.previewUrl) return null;
  return {
    src: photo.previewUrl,
    alt: `${wedding.brideName} e ${wedding.groomName}`,
  };
}
