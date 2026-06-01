export const MAX_PICKS = 3;

export let nodes = [];
export let edges = [];
/** @type {{ node: object, picks: object[] } | null} */
export let browseRoot = null;

export function createBranch(node) {
  return { node, picks: [] };
}

export function setBrowseRoot(branch) {
  browseRoot = branch;
}

export function resetGraph() {
  nodes = [];
  edges = [];
  browseRoot = null;
}

export function maxPickDepth(branch) {
  if (!branch.picks.length) return 0;
  return Math.max(...branch.picks.map(p => maxPickDepth(p) + 1));
}

export function branchesAtPickDepth(branch, targetDepth, depth = 0) {
  if (depth === targetDepth) return [branch];
  return branch.picks.flatMap(p => branchesAtPickDepth(p, targetDepth, depth + 1));
}

/** Nodes on the explored pick path (root first, depth-first through picks). */
export function collectExploredPath(branch, out = []) {
  out.push(branch.node);
  for (const pick of branch.picks) collectExploredPath(pick, out);
  return out;
}

export function childrenOf(parentId) {
  const seen = new Set(), out = [];
  for (const e of edges) {
    if (e.from !== parentId || seen.has(e.to)) continue;
    seen.add(e.to);
    const n = nodes.find(nd => nd.id === e.to);
    if (n) out.push(n);
  }
  return out;
}

export function isEndLinkUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'tiktok.com' || host.endsWith('.tiktok.com') ||
      host === 'instagram.com' || host.endsWith('.instagram.com')
    );
  } catch { return false; }
}

export function linkStatus(n) {
  if (n.isEndLink) return 'End link';
  if (n.crossCited) return 'Cross-cited';
  return '';
}

export function displayLabel(n) {
  const text = n.title || n.label;
  return text.length > 42 ? text.slice(0, 40) + '…' : text;
}

export function displayOutboundLinkLabel(n) {
  const text = (n.title || n.linkName || n.label || '').trim() || n.url;
  return text.length > 42 ? text.slice(0, 40) + '…' : text;
}

export function nodeColor(n) {
  if (n.isRoot) return '#5878C8';
  if (n.isEndLink) return '#C44B8A';
  if (n.crossCited) return '#E8A020';
  if (n.expanded) return '#3aaa7a';
  return '#888';
}

export function placeChildren(parent, links) {
  const existing = new Set(nodes.map(n => n.url));
  return links.map(l => {
    if (existing.has(l.url)) {
      const existingNode = nodes.find(n => n.url === l.url);
      if (existingNode) {
        if (isEndLinkUrl(l.url)) existingNode.isEndLink = true;
        if (!edges.some(e => e.from === parent.id && e.to === existingNode.id)) {
          edges.push({ from: parent.id, to: existingNode.id });
        }
      }
      return null;
    }
    const anchor = (l.text || '').trim();
    const destTitle = (l.title || '').trim();
    const display = destTitle || anchor;
    const endLink = isEndLinkUrl(l.url);
    return {
      id: l.url, url: l.url, label: display.slice(0, 40),
      linkName: anchor, title: display, desc: '', source: null, parentId: parent.id,
      expanded: false, loading: false, isRoot: false, crossCited: false, isEndLink: endLink,
    };
  }).filter(Boolean);
}

export function markCrossCitations() {
  const inCount = {};
  for (const e of edges) inCount[e.to] = (inCount[e.to] || 0) + 1;
  for (const n of nodes) n.crossCited = (inCount[n.id] || 0) > 1 && !n.isRoot;
}

export function syncNodesFromLinkTitles(links) {
  for (const l of links) {
    if (!l.title) continue;
    const n = nodes.find(nd => nd.url === l.url);
    if (n) {
      n.title = l.title;
      n.label = l.title.slice(0, 40);
    }
  }
}
