import { setStatus } from './status.js';

const LOCAL_FETCH_PROXY = location.protocol === 'file:' ? 'http://localhost:3000' : '';
const linkTitleCache = new Map();
const previewCache = new Map();

export function getWikiInfo(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z]+)\.wikipedia\.org$/);
    if (!m) return null;
    const slug = u.pathname.match(/^\/wiki\/(.+)$/)?.[1];
    if (!slug) return null;
    return { lang: m[1], title: decodeURIComponent(slug).replace(/_/g, ' ') };
  } catch { return null; }
}

async function fetchWikipedia(url) {
  const wiki = getWikiInfo(url);
  if (!wiki) return null;
  const { lang, title } = wiki;
  const apiBase = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    titles: title,
    prop: 'extracts|links',
    exintro: '1', explaintext: '1', exsentences: '3',
    plnamespace: '0',
    pllimit: '100',
  });
  const res = await fetch(`${apiBase}?${params}`);
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  if (!pages.length) throw new Error('No page found');
  const page = pages[0];
  const pageTitle = page.title || title;
  const desc = (page.extract || '').replace(/\n/g, ' ').slice(0, 160);
  const rawLinks = page.links || [];
  const links = rawLinks
    .filter(l => !l.title.match(/^(Wikipedia|Help|Template|File|Category|Talk|Portal|Special|User|Draft):/))
    .slice(0, 25)
    .map(l => ({
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(l.title.replace(/ /g, '_'))}`,
      text: l.title,
      title: l.title,
    }));
  return { title: pageTitle, desc, links, source: 'wikipedia' };
}

async function fetchViaProxy(url, signal) {
  const timeout = AbortSignal.timeout(30000);
  const combined = signal
    ? AbortSignal.any([signal, timeout])
    : timeout;
  const res = await fetch(
    `${LOCAL_FETCH_PROXY}/fetch?url=${encodeURIComponent(url)}`,
    { signal: combined },
  );
  const body = await res.text();
  if (!res.ok) {
    let msg = `Proxy HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.error === 'string') msg = parsed.error;
    } catch { /* plain text body */ }
    throw new Error(msg);
  }
  return body;
}

function richTextLabel(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.nodeType === 'text') return node.value || '';
  if (Array.isArray(node.content)) return node.content.map(richTextLabel).join('');
  return '';
}

function extractNextDataLinks(html, baseUrl) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }

  const out = [];
  const seen = new Set();
  function add(href, text) {
    let abs;
    try { abs = new URL(href, baseUrl || undefined).href; } catch { return; }
    if (!abs.startsWith('http') || abs === baseUrl || seen.has(abs)) return;
    const label = (text || '').replace(/\s+/g, ' ').trim();
    if (label.length < 2) return;
    seen.add(abs);
    out.push({ url: abs, text: label.slice(0, 80) });
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.nodeType === 'hyperlink' && node.data?.uri) {
      add(node.data.uri, richTextLabel(node));
    }
    for (const v of Object.values(node)) walk(v);
  }
  walk(data);

  const nr = data?.props?.pageProps?.post?.nextRead?.fields;
  if (nr?.slug && nr?.publishedOn && baseUrl) {
    try {
      const [y, mo] = nr.publishedOn.split('-');
      const origin = new URL(baseUrl).origin;
      add(`${origin}/article/${y}/${mo}/${nr.slug}`, nr.title || 'Next read');
    } catch { /* ignore */ }
  }
  return out;
}

function isBoilerplateHref(href) {
  return /\/(login|logout|signup|register|privacy|terms|cookie|contact|about|faq|help|sitemap|search|tag|category|author|pitch|subscription)/i.test(href);
}

function isSamePageSectionLink(abs, pageUrl) {
  try {
    const a = new URL(abs), p = new URL(pageUrl);
    if (a.origin !== p.origin) return false;
    return /\/i\/\d+/.test(a.pathname) || /\/comments\/?$/i.test(a.pathname);
  } catch { return false; }
}

function isCommentOrSiteChromeLink(abs) {
  return (
    /\/comment\/\d+/i.test(abs) ||
    /\/comments\/?(\?|$)/i.test(abs) ||
    /utm_source=comment/i.test(abs) ||
    /substackcdn\.com|substack-post-media/i.test(abs) ||
    /substack\.com\/(signup|privacy|tos|app\/)/i.test(abs)
  );
}

function getMainContentRoot(doc) {
  const selectors = [
    '[data-testid="post-content"]',
    '.available-content',
    '.body.markup',
    'article .body',
    '.post-body',
    'article',
    'main article',
    'main .content',
    'main',
    '#post-body',
    '.post-content',
    '.entry-content',
    '.article-body',
    '#content',
    '.content',
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.querySelectorAll('a[href^="http"]').length >= 2) return el;
  }
  return null;
}

const CONTENT_EXCLUDE_ANCESTORS =
  'nav,header,footer,aside,[role=navigation],[role=complementary],' +
  '.comment-list,.comments,#comments,[id*="comment"],[class*="comment-list"],' +
  '[class*="comment-thread"],[class*="post-comments"],[data-component-name*="Comment"],' +
  '.subscribe-widget,.post-ufi,.footer-wrap,.post-footer,.site-footer';

function parseMetaDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function parsePageTitle(html) {
  const doc = parseMetaDoc(html);
  const getM = s => (doc.querySelector(s)?.getAttribute('content') || '').trim();
  let title = getM('meta[property="og:title"]') || getM('meta[name="twitter:title"]') || '';
  if (!title) title = (doc.querySelector('title')?.textContent || '').trim();
  return title.replace(/\s*[-–]\s*by\s+.+$/i, '').slice(0, 80).trim();
}

function parsePreviewMeta(html, pageUrl) {
  const doc = parseMetaDoc(html);
  const getM = s => (doc.querySelector(s)?.getAttribute('content') || '').trim();
  let title = getM('meta[property="og:title"]') || getM('meta[name="twitter:title"]') || '';
  if (!title) title = (doc.querySelector('title')?.textContent || '').trim();
  title = title.replace(/\s*[-–]\s*by\s+.+$/i, '').slice(0, 120).trim();
  const desc = (
    getM('meta[property="og:description"]') ||
    getM('meta[name="description"]') ||
    getM('meta[name="twitter:description"]')
  ).slice(0, 200).trim();
  let image =
    getM('meta[property="og:image"]') ||
    getM('meta[property="og:image:url"]') ||
    getM('meta[name="twitter:image"]') ||
    getM('meta[name="twitter:image:src"]');
  if (image) {
    try { image = new URL(image, pageUrl).href; } catch { image = ''; }
  } else {
    image = '';
  }
  return { title, desc, image };
}

async function fetchWikipediaPreview(url, signal) {
  const wiki = getWikiInfo(url);
  if (!wiki) return null;
  const { lang, title } = wiki;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    titles: title,
    prop: 'extracts|pageimages',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    piprop: 'thumbnail',
    pithumbsize: '320',
  });
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikipedia API ${res.status}`);
  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing !== undefined) throw new Error('No page found');
  return {
    title: page.title || title,
    desc: (page.extract || '').replace(/\n/g, ' ').slice(0, 200).trim(),
    image: page.thumbnail?.source || '',
  };
}

/** @returns {Promise<{ title: string, desc: string, image: string }>} */
export async function fetchLinkPreview(url, signal) {
  if (previewCache.has(url)) return previewCache.get(url);
  let result;
  if (getWikiInfo(url)) {
    result = await fetchWikipediaPreview(url, signal);
    if (!result) throw new Error('Preview unavailable');
  } else {
    const html = await fetchViaProxy(url, signal);
    result = parsePreviewMeta(html, url);
  }
  const preview = {
    title: result.title || '',
    desc: result.desc || '',
    image: result.image || '',
  };
  previewCache.set(url, preview);
  return preview;
}

async function fetchLinkTitle(url) {
  if (linkTitleCache.has(url)) return linkTitleCache.get(url);
  if (getWikiInfo(url)) {
    try {
      const result = await fetchWikipedia(url);
      if (result?.title) {
        linkTitleCache.set(url, result.title);
        return result.title;
      }
    } catch { /* fall through to proxy */ }
  }
  try {
    const html = await fetchViaProxy(url);
    const title = parsePageTitle(html);
    if (title) {
      linkTitleCache.set(url, title);
      return title;
    }
  } catch { /* ignore */ }
  linkTitleCache.set(url, null);
  return null;
}

export async function resolveLinkTitles(links) {
  const pending = links.filter(l => !l.title);
  if (!pending.length) return;
  let idx = 0;
  const workers = Math.min(4, pending.length);
  async function worker() {
    while (idx < pending.length) {
      const l = pending[idx++];
      const title = await fetchLinkTitle(l.url);
      if (title) l.title = title;
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
}

function parsePage(html, url) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  let base; try { base = new URL(url); } catch { base = null; }
  const getM = s => (doc.querySelector(s)?.getAttribute('content') || '').trim();
  const title = (getM('meta[property="og:title"]') || doc.querySelector('title')?.textContent || '').slice(0, 80).trim();
  const desc = (getM('meta[property="og:description"]') || getM('meta[name="description"]')).slice(0, 160).trim();

  const contentRoot = getMainContentRoot(doc);
  const seen = new Set(), links = [];
  function pushLink(abs, text) {
    if (!abs.startsWith('http') || abs === url || seen.has(abs)) return;
    if (isSamePageSectionLink(abs, url)) return;
    if (isCommentOrSiteChromeLink(abs)) return;
    const label = (text || '').replace(/\s+/g, ' ').trim();
    if (label.length < 2 || label.length > 80) return;
    if (isBoilerplateHref(abs)) return;
    seen.add(abs);
    links.push({ url: abs, text: label });
  }

  function linkFromAnchor(a) {
    const href = (a.getAttribute('href') || '').trim();
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!href || !text || text.length < 3 || text.length > 80) return;
    if (/^(#|mailto:|javascript:|tel:|data:)/i.test(href)) return;
    if (isBoilerplateHref(href)) return;
    if (a.closest(CONTENT_EXCLUDE_ANCESTORS)) return;
    let abs; try { abs = new URL(href, base || undefined).href; } catch { return; }
    pushLink(abs, text);
  }

  if (contentRoot) {
    for (const a of contentRoot.querySelectorAll('a[href]')) {
      linkFromAnchor(a);
      if (links.length >= 20) break;
    }
  } else {
    for (const { url: href, text } of extractNextDataLinks(html, url)) {
      pushLink(href, text);
      if (links.length >= 20) break;
    }
    if (links.length < 20) {
      let linkEls = [...doc.querySelectorAll('main a, article a, .content a, #content a, #main a, p a')];
      if (linkEls.length < 4) linkEls = [...doc.querySelectorAll('a')];
      for (const a of linkEls) {
        if (a.closest(CONTENT_EXCLUDE_ANCESTORS)) continue;
        linkFromAnchor(a);
        if (links.length >= 20) break;
      }
    }
  }

  return { title, desc, links, source: 'proxy' };
}

export async function fetchPage(url) {
  if (getWikiInfo(url)) {
    setStatus('Loading');
    const result = await fetchWikipedia(url);
    if (result) return result;
  }
  setStatus('Loading');
  const html = await fetchViaProxy(url);
  return parsePage(html, url);
}
