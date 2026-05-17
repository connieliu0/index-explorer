const express = require('express');
const cors = require('cors');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const UPSTREAM_TIMEOUT_MS = 25_000;

const app = express();
app.use(cors({ origin: true }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(ROOT));
app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

app.get('/fetch', async (req, res) => {
  const raw = req.query.url;
  if (raw === undefined || raw === '') {
    return sendError(res, 400, 'Missing required query parameter: url');
  }

  let target;
  try {
    target = new URL(String(raw));
  } catch {
    return sendError(res, 400, 'Invalid URL');
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return sendError(res, 400, 'Only http and https URLs are allowed');
  }

  try {
    const upstream = await fetch(target.href, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        'User-Agent': 'index-explorer-local-proxy/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const body = await upstream.text();

    if (!upstream.ok) {
      return sendError(
        res,
        502,
        `Upstream responded with ${upstream.status} ${upstream.statusText}`,
      );
    }

    const contentType =
      upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.send(body);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return sendError(res, 504, 'Upstream request timed out');
    }
    const msg = err.message || String(err);
    return sendError(res, 502, `Failed to fetch URL: ${msg}`);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Source Explorer listening on port ${PORT}`);
  console.log(`  GET /fetch?url=<encoded-url>`);
});
