import { initStatus, setStatus } from './status.js';
import { resetGraph } from './state.js';
import { initColumns, startExplore } from './columns.js';
import { initMap, setMapButtonEnabled, resetMapView } from './map.js';

initStatus(document.getElementById('status'));
initColumns(document.getElementById('columns-scroll'));

initMap({
  overlay: document.getElementById('map-overlay'),
  canvasWrap: document.getElementById('map-canvas-wrap'),
  canvas: document.getElementById('mini-map'),
  openBtn: document.getElementById('open-map-btn'),
  closeBtn: document.getElementById('map-close-btn'),
  backdrop: document.getElementById('map-backdrop'),
  fitBtn: document.getElementById('map-fit-btn'),
  zoomInBtn: document.getElementById('map-zoom-in'),
  zoomOutBtn: document.getElementById('map-zoom-out'),
});

const fetchBtn = document.getElementById('fetch-btn');
const urlInput = document.getElementById('url-input');

fetchBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  fetchBtn.disabled = true;
  resetGraph();
  resetMapView();
  setMapButtonEnabled(false);
  await startExplore(url);
  setMapButtonEnabled(true);
  fetchBtn.disabled = false;
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchBtn.click();
});

if (location.protocol === 'file:') {
  setStatus('Use npm start — http://localhost:3000');
}
