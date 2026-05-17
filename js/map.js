import {
  browseRoot,
  maxPickDepth,
  branchesAtPickDepth,
  displayLabel,
  nodeColor,
} from './state.js';

const MAP_COL_DX = 100;
const MAP_ROW_DY = 52;
const MAP_NODE_R = 7;
const MAP_LABEL_GAP = 4;
const MAP_LABEL_LINE = 13;

let mapOverlay;
let mapCanvasWrap;
let miniCanvas;
let miniCtx;
let openMapBtn;

let mapView = { scale: 1, panX: 0, panY: 0, userAdjusted: false };
let mapDragging = false;
let mapDragStart = null;

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

function layoutMapTree() {
  if (!browseRoot) return null;
  const depth = maxPickDepth(browseRoot);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let d = 0; d <= depth; d++) {
    const branches = d === 0 ? [browseRoot] : branchesAtPickDepth(browseRoot, d);
    branches.forEach((b, i) => {
      b._mapX = d * MAP_COL_DX;
      b._mapY = (i - (branches.length - 1) / 2) * MAP_ROW_DY;
      b._mapLabelAbove = i % 2 === 1;
      const labelPad = MAP_NODE_R + MAP_LABEL_GAP + MAP_LABEL_LINE;
      minX = Math.min(minX, b._mapX);
      maxX = Math.max(maxX, b._mapX);
      minY = Math.min(minY, b._mapY - (b._mapLabelAbove ? labelPad : MAP_NODE_R));
      maxY = Math.max(maxY, b._mapY + (b._mapLabelAbove ? MAP_NODE_R : labelPad));
    });
  }
  return { minX, maxX, minY, maxY };
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

function drawMapEdge(parent, child) {
  const x1 = parent._mapX + MAP_NODE_R;
  const y1 = parent._mapY;
  const x2 = child._mapX - MAP_NODE_R;
  const y2 = child._mapY;
  const mid = (x1 + x2) / 2;
  miniCtx.beginPath();
  miniCtx.moveTo(x1, y1);
  miniCtx.lineTo(mid, y1);
  miniCtx.lineTo(mid, y2);
  miniCtx.lineTo(x2, y2);
  miniCtx.strokeStyle = '#bbb';
  miniCtx.lineWidth = 1.2 / mapView.scale;
  miniCtx.stroke();
}

function drawMapNode(branch) {
  const n = branch.node;
  miniCtx.beginPath();
  miniCtx.arc(branch._mapX, branch._mapY, MAP_NODE_R, 0, Math.PI * 2);
  miniCtx.fillStyle = nodeColor(n);
  miniCtx.fill();
  miniCtx.strokeStyle = '#fff';
  miniCtx.lineWidth = 1.5 / mapView.scale;
  miniCtx.stroke();

  const label = displayLabel(n);
  miniCtx.font = `${Math.max(9, 11 / mapView.scale)}px "Times New Roman", Times, serif`;
  miniCtx.fillStyle = '#333';
  miniCtx.textAlign = 'center';
  if (branch._mapLabelAbove) {
    miniCtx.textBaseline = 'bottom';
    miniCtx.fillText(label, branch._mapX, branch._mapY - MAP_NODE_R - MAP_LABEL_GAP);
  } else {
    miniCtx.textBaseline = 'top';
    miniCtx.fillText(label, branch._mapX, branch._mapY + MAP_NODE_R + MAP_LABEL_GAP);
  }
}

function walkMapEdges(branch, draw) {
  for (const pick of branch.picks) {
    draw(branch, pick);
    walkMapEdges(pick, draw);
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

  const bounds = layoutMapTree();
  if (!bounds) return;

  if (!mapView.userAdjusted) fitMapView(bounds);

  miniCtx.save();
  miniCtx.translate(mapView.panX, mapView.panY);
  miniCtx.scale(mapView.scale, mapView.scale);

  walkMapEdges(browseRoot, drawMapEdge);
  drawMapNode(browseRoot);
  for (let d = 1; d <= maxPickDepth(browseRoot); d++) {
    for (const b of branchesAtPickDepth(browseRoot, d)) drawMapNode(b);
  }

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

export function initMap(els) {
  mapOverlay = els.overlay;
  mapCanvasWrap = els.canvasWrap;
  miniCanvas = els.canvas;
  miniCtx = miniCanvas.getContext('2d');
  openMapBtn = els.openBtn;

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

  els.openBtn.addEventListener('click', openMap);
  els.closeBtn.addEventListener('click', closeMap);
  els.backdrop.addEventListener('click', closeMap);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isMapOpen()) closeMap();
  });

  new ResizeObserver(() => drawIfOpen()).observe(mapCanvasWrap);
}
