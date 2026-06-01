import { fetchLinkPreview } from './fetch.js';
import { edges, nodes } from './state.js';

const HOVER_DELAY_MS = 280;
const cache = new Map();

let popover;
let showTimer;
let currentAbort;
/** @type {HTMLElement | null} */
let hoveredEl = null;

function ensurePopover() {
  if (popover) return popover;
  popover = document.createElement('div');
  popover.id = 'link-preview';
  popover.className = 'link-preview';
  popover.setAttribute('role', 'tooltip');
  popover.hidden = true;
  document.body.appendChild(popover);
  return popover;
}

function hostnameLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function fillPreviewElement(el, { title, desc, image, url, parentPages = [] }, state = 'ready') {
  const site = hostnameLabel(url);
  const titleText = (title || site).trim();
  const descText = (desc || '').trim();

  el.replaceChildren();
  el.classList.toggle('is-loading', state === 'loading');
  el.classList.toggle('is-error', state === 'error');

  if (image) {
    const img = document.createElement('img');
    img.className = 'link-preview-image';
    img.alt = '';
    img.loading = 'lazy';
    img.src = image;
    img.addEventListener('error', () => img.remove());
    el.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'link-preview-body';

  const siteEl = document.createElement('div');
  siteEl.className = 'link-preview-site';
  siteEl.textContent = site;

  const titleEl = document.createElement('div');
  titleEl.className = 'link-preview-title';
  titleEl.textContent = state === 'loading' && !titleText ? 'Loading…' : titleText;

  body.append(siteEl, titleEl);

  if (descText) {
    const descEl = document.createElement('p');
    descEl.className = 'link-preview-desc';
    descEl.textContent = descText;
    body.appendChild(descEl);
  } else if (state === 'loading') {
    const descEl = document.createElement('p');
    descEl.className = 'link-preview-desc link-preview-desc-muted';
    descEl.textContent = 'Fetching preview…';
    body.appendChild(descEl);
  }

  if (parentPages.length) {
    const refsWrap = document.createElement('div');
    refsWrap.className = 'link-preview-parents';

    const refsTitle = document.createElement('div');
    refsTitle.className = 'link-preview-parents-title';
    refsTitle.textContent = 'Also appears under:';
    refsWrap.appendChild(refsTitle);

    const refsList = document.createElement('ul');
    refsList.className = 'link-preview-parents-list';
    for (const parentTitle of parentPages) {
      const li = document.createElement('li');
      li.textContent = parentTitle;
      refsList.appendChild(li);
    }
    refsWrap.appendChild(refsList);
    body.appendChild(refsWrap);
  }

  el.appendChild(body);
}

function renderCard(data, state = 'ready') {
  const pop = ensurePopover();
  fillPreviewElement(pop, data, state);
}

function positionPopover(anchor) {
  const pop = ensurePopover();
  const gap = 10;
  const margin = 12;
  const ar = anchor.getBoundingClientRect();
  pop.hidden = false;
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = ar.right + gap;
  if (left + pr.width > vw - margin) {
    left = ar.left - gap - pr.width;
  }
  if (left < margin) left = margin;

  let top = ar.top + (ar.height - pr.height) / 2;
  if (top + pr.height > vh - margin) top = vh - margin - pr.height;
  if (top < margin) top = margin;

  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function showPopover(anchor, data, state) {
  if (hoveredEl !== anchor) return;
  renderCard(data, state);
  const pop = ensurePopover();
  pop.hidden = false;
  positionPopover(anchor);
}

function hidePopover() {
  clearTimeout(showTimer);
  showTimer = null;
  currentAbort?.abort();
  currentAbort = null;
  hoveredEl = null;
  if (popover) {
    popover.hidden = true;
    popover.replaceChildren();
  }
}

function snapshotFromNode(node) {
  return {
    url: node.url,
    title: (node.title || node.linkName || node.label || '').trim(),
    desc: (node.desc || '').trim(),
    image: '',
    parentPages: parentPageTitles(node),
  };
}

function parentPageTitles(node) {
  if (!node?.id || !node.crossCited) return [];
  const parentIds = [...new Set(edges.filter(e => e.to === node.id).map(e => e.from))];
  const labels = parentIds
    .map(parentId => nodes.find(n => n.id === parentId))
    .filter(Boolean)
    .map(parentNode => (parentNode.title || parentNode.linkName || parentNode.label || parentNode.url || '').trim())
    .filter(Boolean);
  return [...new Set(labels)].slice(0, 6);
}

function mergePreview(cached, snap) {
  return {
    url: snap.url,
    title: cached?.title || snap.title,
    desc: cached?.desc || snap.desc,
    image: cached?.image || '',
    parentPages: snap.parentPages,
  };
}

export async function loadPreview(node, signal) {
  const snap = snapshotFromNode(node);
  if (cache.has(node.url)) {
    const cached = cache.get(node.url);
    return cached ? mergePreview(cached, snap) : snap;
  }
  const fetched = await fetchLinkPreview(node.url, signal);
  const merged = mergePreview(fetched, snap);
  cache.set(node.url, merged);
  return merged;
}

let inlineAbort;

export function renderInlinePreview(container, node) {
  inlineAbort?.abort();
  const ac = new AbortController();
  inlineAbort = ac;

  const snap = snapshotFromNode(node);
  const card = document.createElement('div');
  card.className = 'link-preview link-preview-inline';
  container.replaceChildren(card);
  fillPreviewElement(card, snap, 'loading');

  void loadPreview(node, ac.signal)
    .then(data => {
      if (ac.signal.aborted) return;
      fillPreviewElement(card, data, 'ready');
    })
    .catch(() => {
      if (ac.signal.aborted) return;
      if (snap.title || snap.desc) {
        fillPreviewElement(card, snap, 'ready');
      } else {
        fillPreviewElement(card, { ...snap, title: hostnameLabel(snap.url) }, 'error');
      }
    });
}

function scheduleShow(anchor, node) {
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    showTimer = null;
    void beginShow(anchor, node);
  }, HOVER_DELAY_MS);
}

async function beginShow(anchor, node) {
  if (hoveredEl !== anchor) return;
  currentAbort?.abort();
  const ac = new AbortController();
  currentAbort = ac;

  const snap = snapshotFromNode(node);
  showPopover(anchor, snap, 'loading');

  try {
    const data = await loadPreview(node, ac.signal);
    if (ac.signal.aborted || hoveredEl !== anchor) return;
    showPopover(anchor, data, 'ready');
  } catch (err) {
    if (ac.signal.aborted || hoveredEl !== anchor) return;
    if (snap.title || snap.desc) {
      showPopover(anchor, snap, 'ready');
    } else {
      showPopover(anchor, { ...snap, title: hostnameLabel(snap.url) }, 'error');
    }
  }
}

function isPreviewTrigger(el) {
  return el?.closest?.('.column-list button, .column-header h2 a, .column-header summary a');
}

export function attachLinkPreview(el, node) {
  el.addEventListener('mouseenter', () => {
    hoveredEl = el;
    scheduleShow(el, node);
  });
  el.addEventListener('mouseleave', (e) => {
    clearTimeout(showTimer);
    showTimer = null;
    if (isPreviewTrigger(e.relatedTarget)) {
      hidePopover();
      return;
    }
    hoveredEl = null;
    hidePopover();
  });
}

export function hideLinkPreview() {
  hidePopover();
}
