export type Wedding = {
  id: number;
  slug: string;
  brideName: string;
  groomName: string;
  weddingDate: string;
  status: string;
  theme?: string | null;
  heroEyebrow?: string | null;
  heroTitle?: string | null;
  heroSubtitle?: string | null;
};

export type PublicScheduleItem = {
  id: number;
  timeLabel: string;
  title: string;
  subtitle: string | null;
  description: string | null;
};

export type PublicLocation = {
  id: number;
  name: string;
  type: string | null;
  address: string | null;
  mapsUrl: string | null;
  description: string | null;
};

export type PublicInfoItem = {
  id: number;
  category: string;
  title: string;
  content: string | null;
};

export type WeddingContent = {
  wedding: Wedding & {
    sections: {
      scheduleEnabled: boolean;
      locationsEnabled: boolean;
      infoEnabled: boolean;
    };
  };
  schedule: PublicScheduleItem[];
  locations: PublicLocation[];
  info: PublicInfoItem[];
};

export const DEFAULT_WEDDING: Wedding = {
  id: 0,
  slug: 'serena-enrico-2027',
  brideName: 'Serena',
  groomName: 'Enrico',
  weddingDate: '2027-07-24',
  status: 'active',
};

export const DEFAULT_WEDDING_DATE = DEFAULT_WEDDING.weddingDate;

export const DEFAULT_WEDDING_CONTENT: WeddingContent = {
  wedding: {
    ...DEFAULT_WEDDING,
    heroEyebrow: 'Ci sposiamo',
    heroTitle: null,
    heroSubtitle: null,
    sections: {
      scheduleEnabled: false,
      locationsEnabled: false,
      infoEnabled: false,
    },
  },
  schedule: [],
  locations: [],
  info: [],
};

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

function isWedding(value: unknown): value is Wedding {
  if (!value || typeof value !== 'object') return false;
  const wedding = value as Record<string, unknown>;

  return (
    typeof wedding.id === 'number' &&
    typeof wedding.slug === 'string' &&
    typeof wedding.brideName === 'string' &&
    typeof wedding.groomName === 'string' &&
    typeof wedding.weddingDate === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(wedding.weddingDate) &&
    typeof wedding.status === 'string'
  );
}

export async function getCurrentWedding(signal?: AbortSignal): Promise<Wedding> {
  const response = await fetch('/api/wedding/current', { signal });

  if (!response.ok) {
    throw new Error(`Wedding request failed with status ${response.status}`);
  }

  const wedding: unknown = await response.json();
  if (!isWedding(wedding)) {
    throw new Error('Wedding response is invalid');
  }

  return wedding;
}

export async function getWeddingContent(signal?: AbortSignal): Promise<WeddingContent> {
  const response = await fetch('/api/wedding/content', { signal });
  if (!response.ok) throw new Error(`Wedding content request failed with status ${response.status}`);
  const content = await response.json() as WeddingContent;
  if (!content?.wedding || !isWedding(content.wedding)) {
    throw new Error('Wedding content response is invalid');
  }
  return {
    wedding: content.wedding,
    schedule: Array.isArray(content.schedule) ? content.schedule : [],
    locations: Array.isArray(content.locations) ? content.locations : [],
    info: Array.isArray(content.info) ? content.info : [],
  };
}
