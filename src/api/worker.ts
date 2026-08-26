export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  ASSETS: Fetcher;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: jsonHeaders });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ status: 'ok' });
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      try {
        const row = await env.DB.prepare(
          'SELECT value FROM app_config WHERE key = ?',
        )
          .bind('wedding_date')
          .first<{ value: string }>();

        if (!row) {
          return json({ error: 'Configuration not found' }, 404);
        }

        return json({ weddingDate: row.value });
      } catch (error) {
        console.error('Unable to read wedding configuration', error);
        return json({ error: 'Configuration unavailable' }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
