import type { ImgHTMLAttributes } from 'react';
import { useAdminImageUrl } from './useAdminImageUrl';

type AdminImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  source: string;
  fallbackSource?: string | null;
};

export function AdminImage({ source, fallbackSource = null, ...props }: AdminImageProps) {
  const objectUrl = useAdminImageUrl(source, fallbackSource);
  return objectUrl ? <img {...props} src={objectUrl} /> : null;
}
