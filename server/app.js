const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const config = require('./config');
const storage = require('./storage');
const clipboardRoutes = require('./routes/clipboard');

const app = express();

// High concurrency: Trust proxy for Render / Cloudflare / Nginx load balancers
app.set('trust proxy', 1);

// Enable gzip/brotli response compression for all responses
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    // Don't compress media files that are already compressed
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  },
  hsts: false, // Prevents mobile browsers from forcing HTTPS on local IP HTTP testing (e.g. 192.168.x.x:3000)
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend with Cache-Control headers for high concurrency performance
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));

// Health check endpoint for uptime monitoring & Render / Railway health checks
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
    activeItems: storage.items.size
  });
});

// Clipboard API routes
app.use('/api', clipboardRoutes);

// Fallback to index.html for SPA hash routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Graceful exit
const shutdown = async () => {
  console.log('Persisting clipboard state and stopping...');
  await storage.persistToDiskAsync();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const server = app.listen(config.PORT, () => {
  console.log(`Online Clipboard listening on port ${config.PORT}`);
});

// Tune keep-alive timeouts for reverse proxies (Render, Cloudflare, AWS ALB)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

module.exports = app;
