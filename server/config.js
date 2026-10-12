const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR: path.join(__dirname, '..', 'data'),
  UPLOADS_DIR: path.join(__dirname, '..', 'data', 'uploads'),
  STORE_FILE: path.join(__dirname, '..', 'data', 'store.json'),
  
  // Maximum total file upload size per session in Megabytes (default 50MB for free cloud tiers)
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50,
  // Maximum text length in characters (approx 2MB of text)
  MAX_TEXT_LENGTH: 2 * 1024 * 1024,
  
  // Expiration durations in milliseconds (1 min to 30 min, default 5 min)
  EXPIRATIONS: {
    '1m': 1 * 60 * 1000,
    '2m': 2 * 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '10m': 10 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '20m': 20 * 60 * 1000,
    '25m': 25 * 60 * 1000,
    '30m': 30 * 60 * 1000
  },
  DEFAULT_EXPIRATION: '5m',

  // Rate limiting parameters to guard against brute-force code guessing
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_ATTEMPTS: 25,          // Max failed attempts per IP
  },

  // Cleanup interval
  CLEANUP_INTERVAL_MS: 60 * 1000, // Every 60 seconds
};
