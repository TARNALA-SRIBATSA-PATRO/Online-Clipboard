const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const util = require('util');
const config = require('./config');

const scryptAsync = util.promisify(crypto.scrypt);

// Code alphabet: avoids visually ambiguous characters (0, O, 1, I, L)
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

class HighConcurrencyClipboardStorage {
  constructor() {
    this.items = new Map();
    this.subscribers = new Map(); // Map<code, Set<res>>
    this.isPersisting = false;
    this.pendingPersist = false;
    this.persistDebounceTimer = null;

    this.ensureDirs();
    this.loadFromDiskSync();
    this.startCleanupTimer();
  }

  ensureDirs() {
    if (!fs.existsSync(config.DATA_DIR)) {
      fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(config.UPLOADS_DIR)) {
      fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
    }
  }

  loadFromDiskSync() {
    try {
      if (fs.existsSync(config.STORE_FILE)) {
        const raw = fs.readFileSync(config.STORE_FILE, 'utf8');
        const data = JSON.parse(raw);
        const now = Date.now();
        for (const [code, item] of Object.entries(data)) {
          if (item.expiresAt > now) {
            this.items.set(code.toUpperCase(), item);
          } else {
            this.deleteFilesAsync(item.files);
          }
        }
      }
    } catch (err) {
      console.error('Initial state load notice:', err.message);
    }
  }

  // Non-blocking, debounced disk persistence to prevent I/O thrashing under 500+ concurrent requests
  schedulePersist() {
    if (this.persistDebounceTimer) return;

    this.persistDebounceTimer = setTimeout(async () => {
      this.persistDebounceTimer = null;
      await this.persistToDiskAsync();
    }, 150); // Debounce by 150ms
  }

  async persistToDiskAsync() {
    if (this.isPersisting) {
      this.pendingPersist = true;
      return;
    }

    this.isPersisting = true;
    try {
      const obj = Object.fromEntries(this.items.entries());
      const tempPath = `${config.STORE_FILE}.${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tmp`;
      const json = JSON.stringify(obj);

      await fsPromises.writeFile(tempPath, json, 'utf8');
      await fsPromises.rename(tempPath, config.STORE_FILE);
    } catch (err) {
      console.error('Async persistence notice:', err.message);
    } finally {
      this.isPersisting = false;
      if (this.pendingPersist) {
        this.pendingPersist = false;
        setImmediate(() => this.persistToDiskAsync());
      }
    }
  }

  // Generates high-entropy 6-character code (supports over 1 billion combinations without collision)
  generateCode() {
    let attempts = 0;
    while (attempts < 200) {
      let code = '';
      const bytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        code += ALPHABET[bytes[i] % ALPHABET.length];
      }

      if (!this.items.has(code)) {
        return code;
      }
      attempts++;
    }
    // High-concurrency fallback with timestamp suffix
    return crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  }

  // Asynchronous password hashing using non-blocking worker pool
  async hashPasswordAsync(password) {
    if (!password) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(password, salt, 32);
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  // Asynchronous password verification using non-blocking worker pool
  async verifyPasswordAsync(storedHash, providedPassword) {
    if (!storedHash) return true;
    if (!providedPassword) return false;
    try {
      const [salt, key] = storedHash.split(':');
      const keyBuffer = Buffer.from(key, 'hex');
      const derivedKey = await scryptAsync(providedPassword, salt, 32);
      return crypto.timingSafeEqual(keyBuffer, derivedKey);
    } catch {
      return false;
    }
  }

  async create({ text, files = [], expiration = '5m', password = null, burnAfterRead = false, liveSync = false }) {
    const code = this.generateCode();
    const editKey = crypto.randomBytes(16).toString('hex');
    let duration = config.EXPIRATIONS[expiration];
    if (!duration) {
      const match = String(expiration || '').match(/^(\d+)m?$/i);
      if (match) {
        const mins = parseInt(match[1], 10);
        if (mins >= 1 && mins <= 30) {
          duration = mins * 60 * 1000;
        }
      }
    }
    if (!duration) {
      duration = config.EXPIRATIONS[config.DEFAULT_EXPIRATION] || 5 * 60 * 1000;
    }
    const now = Date.now();
    const expiresAt = now + duration;

    const passwordHash = await this.hashPasswordAsync(password);

    const payload = {
      code,
      editKey,
      liveSync: Boolean(liveSync) && !burnAfterRead,
      version: 1,
      text: (text || '').trim(),
      files: files.map(f => ({
        id: crypto.randomBytes(8).toString('hex'),
        originalName: f.originalname,
        storedName: f.filename,
        size: f.size,
        mimeType: f.mimetype,
        uploadedAt: now
      })),
      hasPassword: !!password,
      passwordHash,
      burnAfterRead: Boolean(burnAfterRead),
      createdAt: now,
      expiresAt,
      viewsCount: 0
    };

    this.items.set(code, payload);
    this.schedulePersist();

    return {
      code,
      editKey,
      liveSync: payload.liveSync,
      expiresAt,
      burnAfterRead: payload.burnAfterRead,
      hasPassword: payload.hasPassword,
      fileCount: payload.files.length,
      hasText: Boolean(payload.text)
    };
  }

  // Real-time SSE subscription
  subscribe(rawCode, res) {
    const code = (rawCode || '').toUpperCase().trim();
    if (!this.subscribers.has(code)) {
      this.subscribers.set(code, new Set());
    }
    const clientSet = this.subscribers.get(code);
    clientSet.add(res);

    return () => {
      clientSet.delete(res);
      if (clientSet.size === 0) {
        this.subscribers.delete(code);
      }
    };
  }

  // Broadcast real-time update to all active subscribers of this code
  notifySubscribers(code, eventType, data) {
    const clientSet = this.subscribers.get(code.toUpperCase());
    if (!clientSet || clientSet.size === 0) return;

    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clientSet) {
      try {
        res.write(payload);
      } catch {
        clientSet.delete(res);
      }
    }
  }

  // Update text with edit authorization
  async updateText(rawCode, editKey, newText) {
    const code = (rawCode || '').toUpperCase().trim();
    const item = this.items.get(code);

    if (!item) {
      return { success: false, reason: 'not_found' };
    }

    if (Date.now() > item.expiresAt) {
      this.delete(code);
      return { success: false, reason: 'expired' };
    }

    if (item.burnAfterRead) {
      return { success: false, reason: 'burn_restricted' };
    }

    // Verify sender ownership
    if (!item.editKey || item.editKey !== editKey) {
      return { success: false, reason: 'unauthorized' };
    }

    item.text = (newText || '').trim();
    item.version = (item.version || 1) + 1;
    item.updatedAt = Date.now();

    this.schedulePersist();

    // Broadcast instant update to all receivers
    this.notifySubscribers(code, 'text-update', {
      text: item.text,
      version: item.version,
      updatedAt: item.updatedAt
    });

    return {
      success: true,
      text: item.text,
      version: item.version,
      updatedAt: item.updatedAt
    };
  }

  async get(rawCode, password = null) {
    const code = (rawCode || '').toUpperCase().trim();
    const item = this.items.get(code);

    if (!item) {
      return { found: false, reason: 'not_found' };
    }

    if (Date.now() > item.expiresAt) {
      this.delete(code);
      return { found: false, reason: 'expired' };
    }

    if (item.hasPassword) {
      if (!password) {
        return { found: false, reason: 'password_required' };
      }
      const isValid = await this.verifyPasswordAsync(item.passwordHash, password);
      if (!isValid) {
        return { found: false, reason: 'invalid_password' };
      }
    }

    item.viewsCount += 1;

    const result = {
      found: true,
      code: item.code,
      liveSync: Boolean(item.liveSync),
      version: item.version || 1,
      text: item.text,
      files: item.files.map(f => ({
        id: f.id,
        name: f.originalName,
        size: f.size,
        mimeType: f.mimeType,
        uploadedAt: f.uploadedAt
      })),
      burnAfterRead: item.burnAfterRead,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      viewsCount: item.viewsCount
    };

    if (item.burnAfterRead) {
      this.delete(code);
    } else {
      this.schedulePersist();
    }

    return result;
  }

  async getFile(rawCode, fileId, password = null) {
    const code = (rawCode || '').toUpperCase().trim();
    const item = this.items.get(code);

    if (!item) return null;
    if (Date.now() > item.expiresAt) return null;

    if (item.hasPassword) {
      const isValid = await this.verifyPasswordAsync(item.passwordHash, password);
      if (!isValid) return null;
    }

    const file = item.files.find(f => f.id === fileId);
    if (!file) return null;

    const fullPath = path.join(config.UPLOADS_DIR, file.storedName);

    try {
      await fsPromises.access(fullPath, fs.constants.R_OK);
      return {
        fullPath,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size
      };
    } catch {
      return null;
    }
  }

  delete(rawCode) {
    const code = (rawCode || '').toUpperCase().trim();
    const item = this.items.get(code);
    if (item) {
      this.notifySubscribers(code, 'deleted', { code });
      this.deleteFilesAsync(item.files);
      this.items.delete(code);
      this.schedulePersist();
      return true;
    }
    return false;
  }

  async deleteFilesAsync(files = []) {
    for (const f of files) {
      if (!f || !f.storedName) continue;
      const fullPath = path.join(config.UPLOADS_DIR, f.storedName);
      try {
        await fsPromises.unlink(fullPath);
      } catch (err) {
        // Silent ignore if already deleted
      }
    }
  }

  async purgeExpiredAsync() {
    const now = Date.now();
    let changed = false;

    for (const [code, item] of this.items.entries()) {
      if (item.expiresAt <= now) {
        this.items.delete(code);
        this.deleteFilesAsync(item.files);
        changed = true;
      }
    }

    if (changed) {
      this.schedulePersist();
    }
  }

  startCleanupTimer() {
    setInterval(() => {
      this.purgeExpiredAsync().catch(() => {});
    }, config.CLEANUP_INTERVAL_MS).unref();
  }
}

module.exports = new HighConcurrencyClipboardStorage();
