export type SiteAssetType = 'hero' | 'story' | 'location' | 'info' | 'other';
export type SiteAssetStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export type SiteAsset = {
  id: number;
  uuid: string;
  assetType: SiteAssetType;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  status: SiteAssetStatus;
  createdAt: string;
  uploadedAt: string | null;
  processedAt: string | null;
  viewUrl: string | null;
};

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);
export const SITE_ASSET_ACCEPT = [...ALLOWED_TYPES].join(',');
export const SITE_ASSET_MAX_SIZE = 20 * 1024 * 1024;

async function adminJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: 'same-origin', redirect: 'manual' });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'errore di rete';
    throw new Error(`${url}: richiesta non completata (${detail}).`);
  }
  if (response.type === 'opaqueredirect') {
    throw new Error(`${url}: autenticazione Cloudflare Access richiesta.`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(`${url}: HTTP ${response.status}${payload?.error ? ` - ${payload.error}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function listSiteAssets(assetType?: SiteAssetType): Promise<SiteAsset[]> {
  const query = assetType ? `?asset_type=${encodeURIComponent(assetType)}` : '';
  const payload = await adminJson<{ siteAssets?: SiteAsset[] }>(`/api/admin/site-assets${query}`);
  return Array.isArray(payload.siteAssets) ? payload.siteAssets : [];
}

export async function uploadSiteAsset(file: File, assetType: SiteAssetType): Promise<void> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Formato non supportato. Usa JPEG, PNG, WebP, HEIC o HEIF.');
  if (file.size <= 0) throw new Error('Il file selezionato è vuoto.');
  if (file.size > SITE_ASSET_MAX_SIZE) throw new Error('Il file supera il limite di 20 MB.');

  const created = await adminJson<{
    siteAssetId: number;
    uploadUrl: string;
    method: 'PUT';
  }>('/api/admin/site-assets/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size, assetType }),
  });
  const uploaded = await fetch(created.uploadUrl, {
    method: created.method,
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!uploaded.ok) throw new Error(`Upload R2 non riuscito (HTTP ${uploaded.status}).`);
  await adminJson(`/api/admin/site-assets/${created.siteAssetId}/complete`, { method: 'POST' });
}

export async function deleteSiteAsset(id: number): Promise<void> {
  await adminJson(`/api/admin/site-assets/${id}`, { method: 'DELETE' });
}
