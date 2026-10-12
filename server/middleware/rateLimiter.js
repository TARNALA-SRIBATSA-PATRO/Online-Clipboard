const config = require('../config');

// In-memory rate limiter for code retrieval to mitigate brute-force attempts
const attemptsMap = new Map();

function cleanOldEntries() {
  const now = Date.now();
  for (const [ip, entry] of attemptsMap.entries()) {
    if (now > entry.resetAt) {
      attemptsMap.delete(ip);
    }
  }
}

// Cleanup limiter table every 5 minutes
setInterval(cleanOldEntries, 5 * 60 * 1000).unref();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection.remoteAddress || 'unknown';
}

function rateLimitCheck(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = attemptsMap.get(ip);

  if (entry) {
    if (now < entry.resetAt && entry.count >= config.RATE_LIMIT.MAX_ATTEMPTS) {
      const waitMinutes = Math.ceil((entry.resetAt - now) / 60000);
      return res.status(429).json({
        error: 'Too many unsuccessful attempts. Please wait before retrying.',
        retryAfterMinutes: waitMinutes
      });
    }
  }

  next();
}

function recordFailedAttempt(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const entry = attemptsMap.get(ip) || {
    count: 0,
    resetAt: now + config.RATE_LIMIT.WINDOW_MS
  };

  entry.count += 1;
  attemptsMap.set(ip, entry);
}

function recordSuccessfulAttempt(req) {
  const ip = getClientIp(req);
  attemptsMap.delete(ip);
}

module.exports = {
  rateLimitCheck,
  recordFailedAttempt,
  recordSuccessfulAttempt
};
