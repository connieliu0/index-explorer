import { browseRoot, collectExploredPath, displayLabel } from './state.js';
import { hideLinkPreview, renderInlinePreview } from './preview.js';

let toggleBtn;
let exploredPanel;
let columnsScroll;
let exploredList;
let exploredActive = false;
/** @type {string | null} */
let selectedNodeId = null;
/** @type {string | null} */
let hoveredNodeId = null;

export function isExploredViewActive() {
  return exploredActive;
}

export function isNodeInExploredPath(nodeId) {
  if (!browseRoot || !nodeId) return false;
  const pathNodes = collectExploredPath(browseRoot);
  return pathNodes.some(node => node.id === nodeId);
}

function setWorkspaceMode() {
  if (!columnsScroll || !exploredPanel) return;
  columnsScroll.hidden = false;
  exploredPanel.hidden = true;
  columnsScroll.classList.toggle('explored-mode', exploredActive);
}

function deepestNodeId(branch) {
  if (!branch.picks.length) return branch.node.id;
  return deepestNodeId(branch.picks[branch.picks.length - 1]);
}

function renderExploredList() {
  if (!exploredList) return;
  exploredList.replaceChildren();

  if (!browseRoot) {
    const li = document.createElement('li');
    li.className = 'explored-empty';
    li.textContent = 'URL + Go';
    exploredList.appendChild(li);
    return;
  }

  const pathNodes = collectExploredPath(browseRoot);
  if (!selectedNodeId || !pathNodes.some(n => n.id === selectedNodeId)) {
    selectedNodeId = deepestNodeId(browseRoot);
  }
  if (hoveredNodeId && !pathNodes.some(n => n.id === hoveredNodeId)) {
    hoveredNodeId = null;
  }

  for (const node of pathNodes) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.nodeId = node.id;
    if (node.id === selectedNodeId) btn.classList.add('active');
    if (node.isRoot) btn.classList.add('is-root');
    if (node.isEndLink) btn.classList.add('end-link');
    if (node.crossCited) btn.classList.add('cross-cited');

    const label = document.createElement('span');
    label.className = 'explored-label';
    label.textContent = displayLabel(node);
    btn.appendChild(label);

    const link = document.createElement('a');
    link.className = 'explored-open';
    link.href = node.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open';
    link.addEventListener('click', e => e.stopPropagation());

    btn.addEventListener('click', () => {
      selectedNodeId = node.id;
      renderExploredList();
    });

    const row = document.createElement('div');
    row.className = 'explored-row';
    row.addEventListener('mouseenter', () => {
      if (hoveredNodeId === node.id) return;
      hoveredNodeId = node.id;
      renderExploredList();
    });
    row.addEventListener('mouseleave', (e) => {
      if (li.contains(e.relatedTarget)) return;
      if (hoveredNodeId !== node.id) return;
      hoveredNodeId = null;
      renderExploredList();
    });
    row.append(btn, link);
    li.appendChild(row);

    if (node.id === hoveredNodeId) {
      const previewSlot = document.createElement('div');
      previewSlot.className = 'explored-item-preview';
      li.appendChild(previewSlot);
      renderInlinePreview(previewSlot, node);
    }

    exploredList.appendChild(li);
  }
}

export function renderExploredIfActive() {
  if (exploredActive) hideLinkPreview();
}

export function setExploredButtonEnabled(enabled) {
  if (toggleBtn) toggleBtn.disabled = !enabled;
}

function updateToggleButton() {
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-pressed', exploredActive ? 'true' : 'false');
  toggleBtn.textContent = exploredActive ? 'Columns' : 'Explored';
}

function setExploredActive(active) {
  exploredActive = active;
  hoveredNodeId = null;
  updateToggleButton();
  setWorkspaceMode();
  if (exploredActive) {
    hideLinkPreview();
    renderExploredList();
  }
}

export function toggleExploredView() {
  setExploredActive(!exploredActive);
}

export function resetExploredView() {
  selectedNodeId = null;
  hoveredNodeId = null;
  if (exploredActive) setExploredActive(false);
}

export function initExploredView(els) {
  toggleBtn = els.toggleBtn;
  exploredPanel = els.panel;
  columnsScroll = els.columnsScroll;
  exploredList = els.list;

  updateToggleButton();
  setWorkspaceMode();

  toggleBtn.addEventListener('click', toggleExploredView);
}
