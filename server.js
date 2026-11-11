const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const provider = require('./server/provider');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['story', 'check', 'explain', 'technical', 'correction', 'partial', 'answer', 'definition']);
const SESSION_TTL = 30 * 60 * 1000;

function createApp() {
  const app = express();
  // Each ID owns its own history and small retry cache. Nothing is stored on disk.
  const sessions = new Map();
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Same-origin browser requests only; no CORS permissions are enabled.
    if (req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: 'Use the tutor from this server’s page.' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '8kb', strict: true }));

  function pruneSessions() {
    const cutoff = Date.now() - SESSION_TTL;
    for (const [id, session] of sessions) {
      if (session.updatedAt < cutoff) sessions.delete(id);
    }
  }
  const cleanup = setInterval(pruneSessions, 60_000);
  cleanup.unref();

  app.post('/api/session', (req, res) => {
    pruneSessions();
    if (sessions.size >= 1000) return res.status(503).json({ error: 'The demo is busy. Try again later.' });
    const sessionId = randomUUID();
    sessions.set(sessionId, { history: [], requests: new Map(), updatedAt: Date.now() });
    res.status(201).json({ sessionId });
  });

  // A session ID is a temporary bearer secret, not an account or authentication system.
  app.use(['/api/chat', '/api/reset'], (req, res, next) => {
    const id = req.get('x-session-id');
    if (!id || !UUID.test(id)) return res.status(400).json({ error: 'A valid session ID is required.' });
    const session = sessions.get(id);
    if (!session || Date.now() - session.updatedAt > SESSION_TTL) {
      sessions.delete(id);
      return res.status(410).json({ error: 'Your session expired or the server restarted. Start again to begin a new conversation.' });
    }
    req.session = session;
    session.updatedAt = Date.now();
    next();
  });

  function validateBody(req, res, allowed) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
      res.status(400).json({ error: 'Send a JSON object with the supported fields.' });
      return false;
    }
    if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) {
      res.status(400).json({ error: 'A valid request ID is required.' });
      return false;
    }
    return true;
  }
  function replay(req, res, fingerprint) {
    const previous = req.session.requests.get(req.body.requestId);
    if (!previous) return false;
    if (previous.fingerprint !== fingerprint) res.status(409).json({ error: 'That request ID was already used for a different request.' });
    else res.json(previous.response);
    return true;
  }
  function remember(req, fingerprint, response) {
    req.session.requests.set(req.body.requestId, { fingerprint, response });
    // Bound memory use, including cached responses for uncertain network retries.
    if (req.session.requests.size > 20) req.session.requests.delete(req.session.requests.keys().next().value);
  }

  app.post('/api/chat', (req, res) => {
    if (!validateBody(req, res, ['requestId', 'action', 'message'])) return;
    const { action, message } = req.body;
    if ((action !== undefined && (typeof action !== 'string' || !ACTIONS.has(action))) ||
        (message !== undefined && (typeof message !== 'string' || message.trim().length === 0 || message.length > 2000)) ||
        (!action && !message)) {
      return res.status(400).json({ error: 'Use a supported action or a non-empty message of at most 2,000 characters.' });
    }
    const fingerprint = JSON.stringify(['chat', action, message]);
    if (replay(req, res, fingerprint)) return;
    const learnerText = message ? message.trim() : action;
    const reply = provider.respond({ action, message, history: req.session.history });
    req.session.history.push({ role: 'learner', text: learnerText }, { role: 'tutor', ...reply });
    req.session.history = req.session.history.slice(-100);
    const response = { scripted: true, reply };
    remember(req, fingerprint, response);
    res.json(response);
  });

  app.post('/api/reset', (req, res) => {
    if (!validateBody(req, res, ['requestId'])) return;
    const fingerprint = 'reset';
    if (replay(req, res, fingerprint)) return;
    req.session.history = [];
    req.session.requests.clear();
    const response = { scripted: true, reset: true };
    remember(req, fingerprint, response);
    res.json(response);
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  // Only public/ is downloadable. Server code, README, .env and package files stay private.
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));
  app.use((req, res) => res.status(404).send('Not found'));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large. Keep messages below 2,000 characters.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body must be valid JSON.' });
    console.error('Request failed:', error.message);
    res.status(500).json({ error: 'The scripted server could not complete the request. Please retry.' });
  });
  return { app, sessions, close: () => clearInterval(cleanup) };
}

if (require.main === module) {
  const { app } = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '127.0.0.1', () => console.log(`Scripted Analogy Tutor: http://localhost:${port}`));
}
module.exports = { createApp };
