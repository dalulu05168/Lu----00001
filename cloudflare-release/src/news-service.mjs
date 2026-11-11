// Public editorial content only. This service never receives customer credentials.
export function createNewsService({request = fetch, now = Date.now} = {}) {
  const endpoint = 'https://www.finvibe.blog/api/v1/feed?per_page=12';
  let cache, pending;
  const safeUrl = (value, hosts) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url.href : null;
    } catch { return null; }
  };
  async function load() {
    if (cache && now() - cache.at < 60000) return cache.value;
    if (pending) return pending;
    pending = (async () => {
      const headers = {Accept: 'application/json'};
      if (cache?.etag) headers['If-None-Match'] = cache.etag;
      const response = await request(endpoint, {headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(8000)});
      if (response.status === 304 && cache) { cache.at = now(); return cache.value; }
      if (!response.ok) throw Error('News provider HTTP ' + response.status);
      const text = await response.text();
      if (text.length > 512000) throw Error('Invalid news response');
      const data = JSON.parse(text);
      if (!Array.isArray(data.data)) throw Error('Invalid news response');
      const ids = new Set(), items = [];
      for (const row of data.data.slice(0, 50)) {
        const url = safeUrl(row?.url, ['www.finvibe.blog', 'finvibe.blog']);
        const published = Date.parse(row?.published_at);
        const title = typeof row?.title === 'string' ? row.title.trim().slice(0, 300) : '';
        if (!url || !title || !Number.isFinite(published) || published > now() + 60000 || ids.has(url)) continue;
        ids.add(url);
        const image = safeUrl(row.image?.url, ['www.finvibe.blog', 'finvibe.blog', 'images.pexels.com']);
        items.push({id: String(row.id ?? url), title, summary: typeof row.summary === 'string' ? row.summary.slice(0, 600) : '',
          image: image ? {url: image, alt: typeof row.image.alt === 'string' ? row.image.alt.slice(0, 200) : title} : null,
          source: 'FinVibe', publishedAt: new Date(published).toISOString(), url, aiAssisted: row.ai_assisted === true});
      }
      items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      const value = {source: 'FinVibe', section: '财经阅读', items};
      cache = {value, at: now(), etag: response.headers.get('etag')};
      return value;
    })().finally(() => { pending = null; });
    return pending;
  }
  return {load};
}
