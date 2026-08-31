import { useEffect, useState } from 'react';
import { adminFetch } from './adminApi';

const MAX_CONCURRENT_ADMIN_IMAGES = 3;

type ImageRequestWaiter = {
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: DOMException) => void;
  onAbort: () => void;
};

let activeImageRequests = 0;
const imageRequestQueue: ImageRequestWaiter[] = [];

function abortedRequest(): DOMException {
  return new DOMException('The request was aborted.', 'AbortError');
}

function runNextImageRequest(): void {
  while (activeImageRequests < MAX_CONCURRENT_ADMIN_IMAGES && imageRequestQueue.length > 0) {
    const waiter = imageRequestQueue.shift();
    if (!waiter) return;
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    if (waiter.signal.aborted) {
      waiter.reject(abortedRequest());
      continue;
    }

    activeImageRequests += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      activeImageRequests -= 1;
      runNextImageRequest();
    });
  }
}

function acquireImageRequest(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    function onAbort() {
      const index = imageRequestQueue.indexOf(waiter);
      if (index >= 0) imageRequestQueue.splice(index, 1);
      reject(abortedRequest());
    }
    const waiter: ImageRequestWaiter = { signal, resolve, reject, onAbort };
    signal.addEventListener('abort', onAbort, { once: true });
    imageRequestQueue.push(waiter);
    runNextImageRequest();
  });
}

export function useAdminImageUrl(source: string | null, fallbackSource: string | null = null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let activeObjectUrl: string | null = null;

    const load = async () => {
      setObjectUrl(null);
      for (const candidate of [source, fallbackSource]) {
        if (!candidate || controller.signal.aborted) continue;
        try {
          const release = await acquireImageRequest(controller.signal);
          let response: Response;
          let blob: Blob;
          try {
            response = await adminFetch(candidate, { signal: controller.signal });
            const contentType = response.headers.get('content-type') ?? '';
            if (!response.ok || !contentType.startsWith('image/')) continue;
            blob = await response.blob();
          } finally {
            release();
          }
          if (controller.signal.aborted || blob.size === 0) return;
          activeObjectUrl = URL.createObjectURL(blob);
          setObjectUrl(activeObjectUrl);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
    };

    void load();
    return () => {
      controller.abort();
      if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    };
  }, [source, fallbackSource]);

  return objectUrl;
}
