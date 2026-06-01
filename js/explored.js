import { browseRoot, collectExploredPath, displayLabel } from './state.js';
import { hideLinkPreview, renderInlinePreview } from './preview.js';

let toggleBtn;
let exploredPanel;
let columnsScroll;
let exploredList;
let exploredActive = false;
/** @type {string | null} */
let selectedNodeId = null;

export function isExploredViewActive() {
  return exploredActive;
}

function setWorkspaceMode() {
  if (!columnsScroll || !exploredPanel) return;
  columnsScroll.hidden = exploredActive;
  exploredPanel.hidden = !exploredActive;
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
    row.append(btn, link);
    li.appendChild(row);

    if (node.id === selectedNodeId) {
      const previewSlot = document.createElement('div');
      previewSlot.className = 'explored-item-preview';
      li.appendChild(previewSlot);
      renderInlinePreview(previewSlot, node);
    }

    exploredList.appendChild(li);
  }
}

export function renderExploredIfActive() {
  if (!exploredActive) return;
  hideLinkPreview();
  renderExploredList();
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
