import {
  browseRoot,
  maxPickDepth,
  branchesAtPickDepth,
  nodeColor,
  childrenOf,
} from './state.js';

const MAP_ROW_DY = 44;
const MAP_ROW_GAP = 4;
const MAP_NODE_R = 6;
const MAP_COL_GAP = 10;
const MAP_LABEL_GAP = 4;
const MAP_LABEL_Y_OFFSET = 9;
const MAP_LABEL_LINE = 11;
const MAP_LABEL_MAX = 22;
const MAP_CHAR_W = 6.4;

let mapOverlay;
let mapCanvasWrap;
let miniCanvas;
let miniCtx;
let openMapBtn;
let mapModeBtn;

/** @type {'path' | 'all-links'} */
let mapMode = 'path';

let mapView = { scale: 1, panX: 0, panY: 0, userAdjusted: false };
let mapDragging = false;
let mapDragStart = null;

/** @type {{ node: object, x: number, y: number, selected: boolean, parentBranch: object }[]} */
let mapLinkSlots = [];

export function isMapOpen() {
  return mapOverlay?.classList.contains('open') ?? false;
}

export function openMap() {
  if (!browseRoot) return;
  mapOverlay.classList.add('open');
  mapOverlay.setAttribute('aria-hidden', 'false');
  mapView.userAdjusted = false;
  drawMiniMap();
}

export function closeMap() {
  mapOverlay.classList.remove('open');
  mapOverlay.setAttribute('aria-hidden', 'true');
}

export function drawIfOpen() {
  if (isMapOpen()) drawMiniMap();
}

function mapLabel(n) {
  const text = n.title || n.label;
  return text.length > MAP_LABEL_MAX ? text.slice(0, MAP_LABEL_MAX - 1) + '…' : text;
}

function mapLabelWidth(text) {
  return text.length * MAP_CHAR_W;
}

function applyBranchLabelLayout(branch, x, y, labelAbove) {
  const label = mapLabel(branch.node);
  const labelW = mapLabelWidth(label);
  const labelX = x + MAP_NODE_R + MAP_LABEL_GAP;
  const labelY = labelAbove ? y - MAP_LABEL_Y_OFFSET : y + MAP_LABEL_Y_OFFSET;
  branch._mapX = x;
  branch._mapY = y;
  branch._mapLabelAbove = labelAbove;
  branch._mapLabelX = labelX;
  branch._mapLabelY = labelY;
  branch._mapLabelW = labelW;
}

function branchLabelBounds(branch) {
  return {
    minX: branch._mapX - MAP_NODE_R,
    maxX: branch._mapLabelX + branch._mapLabelW,
    minY: branch._mapLabelY - MAP_LABEL_LINE / 2,
    maxY: branch._mapLabelY + MAP_LABEL_LINE / 2,
  };
}

function growBounds(bounds, b) {
  bounds.minX = Math.min(bounds.minX, b.minX);
  bounds.maxX = Math.max(bounds.maxX, b.maxX);
  bounds.minY = Math.min(bounds.minY, b.minY);
  bounds.maxY = Math.max(bounds.maxY, b.maxY);
}

function columnStrideForNode(node) {
  const labelW = mapLabelWidth(mapLabel(node));
  return MAP_NODE_R * 2 + MAP_LABEL_GAP + labelW + MAP_COL_GAP;
}

function layoutMapTree() {
  if (!browseRoot) return null;
  const depth = maxPickDepth(browseRoot);
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let colX = 0;

  for (let d = 0; d <= depth; d++) {
    const branches = d === 0 ? [browseRoot] : branchesAtPickDepth(browseRoot, d);
    let colLabelW = 0;
    for (const b of branches) {
      colLabelW = Math.max(colLabelW, mapLabelWidth(mapLabel(b.node)));
    }
    const colStride = MAP_NODE_R * 2 + MAP_LABEL_GAP + colLabelW + MAP_COL_GAP;

    branches.forEach((b, i) => {
      applyBranchLabelLayout(b, colX, (i - (branches.length - 1) / 2) * MAP_ROW_DY, (d + i) % 2 === 1);
      growBounds(bounds, branchLabelBounds(b));
    });
    colX += colStride;
  }
  return bounds;
}

function subtreeHeight(branch) {
  const children = childrenOf(branch.node.id);
  if (!children.length) return MAP_ROW_DY;
  let total = 0;
  for (let i = 0; i < children.length; i++) {
    const pick = branch.picks.find(p => p.node.id === children[i].id);
    total += (pick ? subtreeHeight(pick) : MAP_ROW_DY);
    if (i < children.length - 1) total += MAP_ROW_GAP;
  }
  return Math.max(total, MAP_ROW_DY);
}

function layoutAllLinksFan(branch, linkColX, yCenter, labelFlip, bounds) {
  const children = childrenOf(branch.node.id);
  if (!children.length) return;

  const childHeights = children.map(child => {
    const pick = branch.picks.find(p => p.node.id === child.id);
    return pick ? subtreeHeight(pick) : MAP_ROW_DY;
  });
  const totalH = childHeights.reduce((a, b) => a + b, 0)
    + Math.max(0, children.length - 1) * MAP_ROW_GAP;

  let y = yCenter - totalH / 2;
  children.forEach((child, i) => {
    const cy = y + childHeights[i] / 2;
    const pick = branch.picks.find(p => p.node.id === child.id);
    const selected = Boolean(pick);

    mapLinkSlots.push({ node: child, x: linkColX, y: cy, selected, parentBranch: branch });

    const slotBounds = {
      minX: linkColX - MAP_NODE_R,
      maxX: linkColX + MAP_NODE_R + MAP_LABEL_GAP + mapLabelWidth(mapLabel(child)),
      minY: cy - MAP_LABEL_LINE / 2,
      maxY: cy + MAP_LABEL_LINE / 2,
    };
    growBounds(bounds, slotBounds);

    if (pick) {
      applyBranchLabelLayout(pick, linkColX, cy, (labelFlip + i) % 2 === 1);
      growBounds(bounds, branchLabelBounds(pick));
      layoutAllLinksFan(
        pick,
        linkColX + columnStrideForNode(pick.node),
        cy,
        (labelFlip + i + 1) % 2 === 1,
        bounds,
      );
    }

    y += childHeights[i] + MAP_ROW_GAP;
  });
}

function layoutAllLinksMap() {
  if (!browseRoot) return null;
  mapLinkSlots = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  applyBranchLabelLayout(browseRoot, 0, 0, false);
  growBounds(bounds, branchLabelBounds(browseRoot));
  layoutAllLinksFan(browseRoot, columnStrideForNode(browseRoot.node), 0, false, bounds);
  return bounds;
}

function fitMapView(bounds) {
  const W = mapCanvasWrap.clientWidth, H = mapCanvasWrap.clientHeight;
  if (!bounds || W < 1 || H < 1) return;
  const pad = 28;
  const graphW = Math.max(bounds.maxX - bounds.minX, 1) + pad * 2;
  const graphH = Math.max(bounds.maxY - bounds.minY, 1) + pad * 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  mapView.scale = Math.min(W / graphW, H / graphH, 2.5) * 0.9;
  mapView.panX = W / 2 - cx * mapView.scale;
  mapView.panY = H / 2 - cy * mapView.scale;
}

function drawMapEdge(parent, child, selected) {
  const x1 = parent._mapX + MAP_NODE_R;
  const y1 = parent._mapY;
  const x2 = (child._mapX ?? child.x) - MAP_NODE_R;
  const y2 = child._mapY ?? child.y;
  const mid = (x1 + x2) / 2;
  miniCtx.beginPath();
  miniCtx.moveTo(x1, y1);
  miniCtx.lineTo(mid, y1);
  miniCtx.lineTo(mid, y2);
  miniCtx.lineTo(x2, y2);
  miniCtx.strokeStyle = selected ? '#111' : '#ccc';
  miniCtx.lineWidth = (selected ? 1.8 : 1) / mapView.scale;
  miniCtx.stroke();
}

function drawMapNodeAt(x, y, node, selected, labelAbove) {
  miniCtx.beginPath();
  miniCtx.arc(x, y, MAP_NODE_R, 0, Math.PI * 2);
  miniCtx.fillStyle = selected ? '#111' : '#c8c8c8';
  miniCtx.fill();
  if (!selected) {
    miniCtx.strokeStyle = '#aaa';
    miniCtx.lineWidth = 1 / mapView.scale;
    miniCtx.stroke();
  }

  const label = mapLabel(node);
  const fontSize = Math.max(9, 11 / mapView.scale);
  miniCtx.font = `${fontSize}px "Times New Roman", Times, serif`;
  miniCtx.fillStyle = selected ? '#111' : '#999';
  miniCtx.textAlign = 'left';
  miniCtx.textBaseline = 'middle';
  const labelX = x + MAP_NODE_R + MAP_LABEL_GAP;
  const labelY = labelAbove ? y - MAP_LABEL_Y_OFFSET : y + MAP_LABEL_Y_OFFSET;
  miniCtx.fillText(label, labelX, labelY);
}

function drawMapNode(branch) {
  if (mapMode === 'all-links') {
    drawMapNodeAt(branch._mapX, branch._mapY, branch.node, true, branch._mapLabelAbove);
    return;
  }
  const n = branch.node;
  miniCtx.beginPath();
  miniCtx.arc(branch._mapX, branch._mapY, MAP_NODE_R, 0, Math.PI * 2);
  miniCtx.fillStyle = nodeColor(n);
  miniCtx.fill();
  miniCtx.strokeStyle = '#fff';
  miniCtx.lineWidth = 1.5 / mapView.scale;
  miniCtx.stroke();

  const label = mapLabel(n);
  const fontSize = Math.max(9, 11 / mapView.scale);
  miniCtx.font = `${fontSize}px "Times New Roman", Times, serif`;
  miniCtx.fillStyle = '#333';
  miniCtx.textAlign = 'left';
  miniCtx.textBaseline = 'middle';
  miniCtx.fillText(label, branch._mapLabelX, branch._mapLabelY);
}

function walkMapEdges(branch, draw) {
  for (const pick of branch.picks) {
    draw(branch, pick);
    walkMapEdges(pick, draw);
  }
}

function walkAllLinksEdges(branch) {
  for (const slot of mapLinkSlots) {
    if (slot.parentBranch !== branch) continue;
    drawMapEdge(branch, slot, slot.selected);
    const pick = branch.picks.find(p => p.node.id === slot.node.id);
    if (pick) walkAllLinksEdges(pick);
  }
}

function collectBranches(branch, out) {
  out.push(branch);
  for (const pick of branch.picks) collectBranches(pick, out);
}

function drawPathMap(bounds) {
  walkMapEdges(browseRoot, (parent, child) => drawMapEdge(parent, child, true));
  drawMapNode(browseRoot);
  for (let d = 1; d <= maxPickDepth(browseRoot); d++) {
    for (const b of branchesAtPickDepth(browseRoot, d)) drawMapNode(b);
  }
}

function drawAllLinksMap() {
  walkAllLinksEdges(browseRoot);
  const branches = [];
  collectBranches(browseRoot, branches);
  for (const b of branches) drawMapNode(b);
  for (const slot of mapLinkSlots) {
    if (branches.some(b => b.node.id === slot.node.id)) continue;
    drawMapNodeAt(slot.x, slot.y, slot.node, slot.selected, false);
  }
}

export function drawMiniMap() {
  const dpr = window.devicePixelRatio || 1;
  const W = mapCanvasWrap.clientWidth, H = mapCanvasWrap.clientHeight;
  miniCanvas.width = W * dpr;
  miniCanvas.height = H * dpr;
  miniCanvas.style.width = W + 'px';
  miniCanvas.style.height = H + 'px';
  miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  miniCtx.clearRect(0, 0, W, H);

  const bounds = mapMode === 'all-links' ? layoutAllLinksMap() : layoutMapTree();
  if (!bounds) return;

  if (!mapView.userAdjusted) fitMapView(bounds);

  miniCtx.save();
  miniCtx.translate(mapView.panX, mapView.panY);
  miniCtx.scale(mapView.scale, mapView.scale);

  if (mapMode === 'all-links') drawAllLinksMap();
  else drawPathMap(bounds);

  miniCtx.restore();
}

function mapZoomAt(factor, cx, cy) {
  const newScale = Math.min(4, Math.max(0.25, mapView.scale * factor));
  mapView.panX = cx - (cx - mapView.panX) * (newScale / mapView.scale);
  mapView.panY = cy - (cy - mapView.panY) * (newScale / mapView.scale);
  mapView.scale = newScale;
  mapView.userAdjusted = true;
  drawMiniMap();
}

export function resetMapView() {
  mapView.userAdjusted = false;
}

export function setMapButtonEnabled(enabled) {
  if (openMapBtn) openMapBtn.disabled = !enabled;
}

function updateMapModeButton() {
  if (!mapModeBtn) return;
  mapModeBtn.textContent = mapMode === 'all-links' ? 'Path only' : 'All links';
  mapModeBtn.setAttribute('aria-pressed', mapMode === 'all-links' ? 'true' : 'false');
}

function toggleMapMode() {
  mapMode = mapMode === 'all-links' ? 'path' : 'all-links';
  mapView.userAdjusted = false;
  updateMapModeButton();
  drawMiniMap();
}

export function initMap(els) {
  mapOverlay = els.overlay;
  mapCanvasWrap = els.canvasWrap;
  miniCanvas = els.canvas;
  miniCtx = miniCanvas.getContext('2d');
  openMapBtn = els.openBtn;
  mapModeBtn = els.modeBtn;
  updateMapModeButton();

  miniCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = miniCanvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 0.88;
    mapZoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  miniCanvas.addEventListener('mousedown', e => {
    mapDragging = true;
    miniCanvas.classList.add('dragging');
    mapDragStart = { x: e.clientX, y: e.clientY, panX: mapView.panX, panY: mapView.panY };
    mapView.userAdjusted = true;
  });

  window.addEventListener('mousemove', e => {
    if (!mapDragging || !mapDragStart) return;
    mapView.panX = mapDragStart.panX + (e.clientX - mapDragStart.x);
    mapView.panY = mapDragStart.panY + (e.clientY - mapDragStart.y);
    drawMiniMap();
  });

  window.addEventListener('mouseup', () => {
    mapDragging = false;
    mapDragStart = null;
    miniCanvas.classList.remove('dragging');
  });

  miniCanvas.addEventListener('dblclick', () => {
    mapView.userAdjusted = false;
    drawMiniMap();
  });

  els.fitBtn.addEventListener('click', () => {
    mapView.userAdjusted = false;
    drawMiniMap();
  });
  els.zoomInBtn.addEventListener('click', () => {
    mapZoomAt(1.25, mapCanvasWrap.clientWidth / 2, mapCanvasWrap.clientHeight / 2);
  });
  els.zoomOutBtn.addEventListener('click', () => {
    mapZoomAt(0.8, mapCanvasWrap.clientWidth / 2, mapCanvasWrap.clientHeight / 2);
  });

  els.modeBtn.addEventListener('click', toggleMapMode);

  els.openBtn.addEventListener('click', openMap);
  els.closeBtn.addEventListener('click', closeMap);
  els.backdrop.addEventListener('click', closeMap);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isMapOpen()) closeMap();
  });

  new ResizeObserver(() => drawIfOpen()).observe(mapCanvasWrap);
}
