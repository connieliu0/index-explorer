import { setStatus } from './status.js';
import { fetchPage, resolveLinkTitles } from './fetch.js';
import { drawIfOpen } from './map.js';
import {
  MAX_PICKS,
  nodes,
  edges,
  browseRoot,
  setBrowseRoot,
  createBranch,
  childrenOf,
  linkStatus,
  displayOutboundLinkLabel,
  isEndLinkUrl,
  placeChildren,
  markCrossCitations,
  syncNodesFromLinkTitles,
  maxPickDepth,
  branchesAtPickDepth,
} from './state.js';

let columnsScroll;

export function initColumns(el) {
  columnsScroll = el;
}

function buildPanel(branch) {
  const node = branch.node;
  const pickedIds = new Set(branch.picks.map(p => p.node.id));

  const panel = document.createElement('div');
  panel.className = 'stack-panel';

  const header = document.createElement('div');
  header.className = 'column-header';
  const title = node.title || node.label;

  function articleLink() {
    const a = document.createElement('a');
    a.href = node.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = title;
    a.addEventListener('click', e => e.stopPropagation());
    return a;
  }

  if (node.desc) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.appendChild(articleLink());
    const p = document.createElement('p');
    p.className = 'desc-body';
    p.textContent = node.desc;
    details.append(summary, p);
    header.appendChild(details);
  } else {
    const h2 = document.createElement('h2');
    h2.appendChild(articleLink());
    header.appendChild(h2);
  }

  const list = document.createElement('ul');
  list.className = 'column-list';

  if (node.loadError) {
    list.innerHTML = `<li class="column-empty">Failed: ${node.loadError.slice(0, 100)}</li>`;
  } else if (node.loading) {
    list.innerHTML = '<li class="column-empty">Loading</li>';
  } else if (!node.expanded) {
    list.innerHTML = '<li class="column-empty">—</li>';
  } else {
    const kids = childrenOf(node.id);
    if (!kids.length) {
      list.innerHTML = '<li class="column-empty">No links</li>';
    } else {
      for (const child of kids) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        if (pickedIds.has(child.id)) btn.classList.add('active');
        if (child.isEndLink) btn.classList.add('end-link');
        const titleSpan = document.createElement('span');
        titleSpan.textContent = displayOutboundLinkLabel(child);
        btn.appendChild(titleSpan);
        const status = linkStatus(child);
        if (status) {
          const statusSpan = document.createElement('span');
          statusSpan.className = 'link-status';
          statusSpan.textContent = ' ' + status;
          btn.appendChild(statusSpan);
        }
        btn.addEventListener('click', () => onColumnItemClick(branch, child));
        li.appendChild(btn);
        list.appendChild(li);
      }
    }
  }

  panel.append(header, list);
  return panel;
}

export function renderColumns() {
  columnsScroll.innerHTML = '';
  if (!browseRoot) {
    columnsScroll.innerHTML = '<div class="column-empty">URL + Go</div>';
    return;
  }
  const col1 = document.createElement('aside');
  col1.className = 'column';
  col1.appendChild(buildPanel(browseRoot));
  columnsScroll.appendChild(col1);

  const depth = maxPickDepth(browseRoot);
  for (let d = 1; d <= depth; d++) {
    const branches = branchesAtPickDepth(browseRoot, d);
    const col = document.createElement('aside');
    col.className = 'column';
    const stack = document.createElement('div');
    stack.className = 'column-stack';
    for (const branch of branches) stack.appendChild(buildPanel(branch));
    col.appendChild(stack);
    columnsScroll.appendChild(col);
  }
  columnsScroll.lastElementChild?.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
}

async function expandNode(node) {
  if (node.isEndLink) return false;
  if (node.loading) return false;
  if (node.expanded) return true;
  node.loading = true;
  node.loadError = null;
  renderColumns();
  try {
    const { title, desc, links, source } = await fetchPage(node.url);
    node.title = title || node.linkName || node.label;
    node.desc = desc;
    node.source = source;
    node.expanded = true;
    node.loading = false;
    const children = placeChildren(node, links);
    for (const c of children) { nodes.push(c); edges.push({ from: node.id, to: c.id }); }
    markCrossCitations();
    setStatus(`${children.length} links`);
    renderColumns();
    drawIfOpen();
    const resolvable = links.filter(l => !l.title && !isEndLinkUrl(l.url));
    if (resolvable.length) {
      setStatus('Resolving titles');
      resolveLinkTitles(resolvable).then(() => {
        syncNodesFromLinkTitles(resolvable);
        setStatus(`${children.length} links`);
        renderColumns();
        drawIfOpen();
      });
    }
    return true;
  } catch (err) {
    node.loading = false;
    node.loadError = err.message;
    setStatus('Failed: ' + err.message.slice(0, 120));
    renderColumns();
    drawIfOpen();
    return false;
  }
}

async function onColumnItemClick(branch, child) {
  if (child.isEndLink) {
    window.open(child.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const idx = branch.picks.findIndex(p => p.node === child);
  if (idx >= 0) {
    branch.picks.splice(idx, 1);
    renderColumns();
    drawIfOpen();
    return;
  }
  if (branch.picks.length >= MAX_PICKS) branch.picks.shift();
  const ok = await expandNode(child);
  if (!ok) return;
  branch.picks.push(createBranch(child));
  renderColumns();
  drawIfOpen();
}

export async function startExplore(url) {
  const root = {
    id: url, url, label: '…', title: '', desc: '', source: null, parentId: null,
    isRoot: true, expanded: false, loading: true, crossCited: false,
  };
  nodes.push(root);
  setBrowseRoot(createBranch(root));
  renderColumns();
  try {
    const { title, desc, links, source } = await fetchPage(url);
    root.title = title || url;
    root.label = (title || new URL(url).hostname).slice(0, 20);
    root.desc = desc;
    root.source = source;
    root.loading = false;
    root.expanded = true;
    const children = placeChildren(root, links);
    for (const c of children) { nodes.push(c); edges.push({ from: root.id, to: c.id }); }
    markCrossCitations();
    setStatus(`${children.length} links`);
    const resolvable = links.filter(l => !l.title && !isEndLinkUrl(l.url));
    if (resolvable.length) {
      resolveLinkTitles(resolvable).then(() => {
        syncNodesFromLinkTitles(resolvable);
        renderColumns();
        drawIfOpen();
      });
    }
  } catch (err) {
    root.loading = false;
    root.label = 'Error';
    setStatus('Failed: ' + err.message);
  }
  renderColumns();
  drawIfOpen();
}
