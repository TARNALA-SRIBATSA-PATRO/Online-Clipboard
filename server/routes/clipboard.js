const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');
const storage = require('../storage');
const { rateLimitCheck, recordFailedAttempt, recordSuccessfulAttempt } = require('../middleware/rateLimiter');

// Setup multer disk storage with randomized filenames
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const randomHex = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${randomHex}${ext}`);
  }
});

const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 10
  }
});

// Provide server configuration limits
router.get('/limits', (req, res) => {
  res.json({
    maxFileSizeMb: config.MAX_FILE_SIZE_MB,
    expirations: Object.keys(config.EXPIRATIONS),
    defaultExpiration: config.DEFAULT_EXPIRATION
  });
});

// Share new text or files
router.post('/share', upload.array('files', 10), async (req, res) => {
  try {
    const text = req.body.text || '';
    const files = req.files || [];
    const expiration = req.body.expiration || config.DEFAULT_EXPIRATION;
    const password = req.body.password ? req.body.password.trim() : null;
    const burnAfterRead = req.body.burnAfterRead === 'true' || req.body.burnAfterRead === true;
    const liveSync = req.body.liveSync === 'true' || req.body.liveSync === true;

    if (!text.trim() && files.length === 0) {
      storage.deleteFilesAsync(files.map(f => ({ storedName: f.filename })));
      return res.status(400).json({ error: 'Please provide either text content or at least one file.' });
    }

    if (text.length > config.MAX_TEXT_LENGTH) {
      storage.deleteFilesAsync(files.map(f => ({ storedName: f.filename })));
      return res.status(400).json({ error: `Text exceeds maximum allowed length of ${config.MAX_TEXT_LENGTH} characters.` });
    }

    const item = await storage.create({
      text,
      files,
      expiration,
      password,
      burnAfterRead,
      liveSync
    });

    const host = req.get('host');
    const protocol = req.protocol;
    const directUrl = `${protocol}://${host}/#code=${item.code}`;

    let qrCodeDataUrl = null;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(directUrl, {
        margin: 2,
        width: 240,
        color: {
          dark: '#111317',
          light: '#f5f5f7'
        }
      });
    } catch (qrErr) {
      // Non-critical fallback
    }

    res.json({
      success: true,
      code: item.code,
      editKey: item.editKey,
      liveSync: item.liveSync,
      expiresAt: item.expiresAt,
      burnAfterRead: item.burnAfterRead,
      hasPassword: item.hasPassword,
      fileCount: item.fileCount,
      hasText: item.hasText,
      directUrl,
      qrCode: qrCodeDataUrl
    });
  } catch (err) {
    console.error('Share processing error:', err.message);
    res.status(500).json({ error: 'Server error while processing clipboard payload.' });
  }
});

// Retrieve payload by code
router.post('/receive', rateLimitCheck, async (req, res) => {
  try {
    const code = (req.body.code || '').trim().replace(/\s+/g, '').toUpperCase();
    const password = req.body.password ? req.body.password.trim() : null;

    if (!code) {
      return res.status(400).json({ error: 'Code is required.' });
    }

    const result = await storage.get(code, password);

    if (!result.found) {
      if (result.reason === 'password_required') {
        return res.status(401).json({
          error: 'This clipboard is password protected. Enter the password to view.',
          code: 'PASSWORD_REQUIRED'
        });
      }
      if (result.reason === 'invalid_password') {
        recordFailedAttempt(req);
        return res.status(401).json({
          error: 'Incorrect password. Access denied.',
          code: 'INVALID_PASSWORD'
        });
      }
      if (result.reason === 'expired') {
        recordFailedAttempt(req);
        return res.status(404).json({
          error: 'This clipboard item has expired and was removed.',
          code: 'EXPIRED'
        });
      }

      recordFailedAttempt(req);
      return res.status(404).json({
        error: 'Invalid or unknown code. Check the code and try again.',
        code: 'NOT_FOUND'
      });
    }

    recordSuccessfulAttempt(req);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('Receive processing error:', err.message);
    res.status(500).json({ error: 'Server error while processing request.' });
  }
});

// File streaming download / inline preview (zero memory buffering for 500+ clients)
router.get('/file/:code/:fileId', async (req, res) => {
  try {
    const { code, fileId } = req.params;
    const password = req.query.pwd || null;
    const inline = req.query.inline === 'true';

    const file = await storage.getFile(code, fileId, password);
    if (!file) {
      return res.status(404).send('File not found, expired, or access denied.');
    }

    const safeFilename = encodeURIComponent(file.originalName);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', file.size);
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${safeFilename}`
    );

    // Stream directly via pipeline with proper backpressure
    const stream = fs.createReadStream(file.fullPath);
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).send('Streaming error.');
      }
    });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).send('Error retrieving file.');
    }
  }
});

// Manual immediate destruction
router.delete('/burn/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const deleted = storage.delete(code);
  if (deleted) {
    return res.json({ success: true, message: 'Payload burned and permanently deleted.' });
  }
  res.status(404).json({ error: 'Clipboard item not found or already deleted.' });
});

// Update text in real-time (sender authorized via editKey)
router.put('/update-text', async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    const editKey = req.body.editKey ? req.body.editKey.trim() : null;
    const text = req.body.text || '';

    if (!code || !editKey) {
      return res.status(400).json({ error: 'Code and edit key are required.' });
    }

    if (text.length > config.MAX_TEXT_LENGTH) {
      return res.status(400).json({ error: `Text exceeds maximum allowed length of ${config.MAX_TEXT_LENGTH} characters.` });
    }

    const result = await storage.updateText(code, editKey, text);

    if (!result.success) {
      if (result.reason === 'unauthorized') {
        return res.status(403).json({ error: 'Unauthorized: edit key does not match.' });
      }
      if (result.reason === 'burn_restricted') {
        return res.status(400).json({ error: 'Self-destruct clipboards cannot be updated.' });
      }
      if (result.reason === 'expired') {
        return res.status(404).json({ error: 'Clipboard item has expired.' });
      }
      return res.status(404).json({ error: 'Clipboard item not found.' });
    }

    res.json({
      success: true,
      text: result.text,
      version: result.version,
      updatedAt: result.updatedAt
    });
  } catch (err) {
    console.error('Update text error:', err.message);
    res.status(500).json({ error: 'Server error while updating text.' });
  }
});

// Server-Sent Events (SSE) stream for real-time live synchronization
router.get('/stream/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const item = storage.items.get(code);

  if (!item || Date.now() > item.expiresAt) {
    return res.status(404).send('Clipboard not found or expired.');
  }

  // Prevent SSE on burn-after-read items
  if (item.burnAfterRead) {
    return res.status(400).send('Live streaming disabled for one-time burn items.');
  }

  // Set SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Keep-alive heartbeat every 20 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ code, version: item.version || 1 })}\n\n`);

  // Subscribe to storage changes
  const unsubscribe = storage.subscribe(code, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;
