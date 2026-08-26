export const DEFAULT_WEDDING_DATE = '2027-07-24';

export type WeddingConfig = {
  weddingDate: string;
};

export async function getWeddingConfig(signal?: AbortSignal): Promise<WeddingConfig> {
  const response = await fetch('/api/config', { signal });

  if (!response.ok) {
    throw new Error(`Config request failed with status ${response.status}`);
  }

  return response.json() as Promise<WeddingConfig>;
}
