# Online Clipboard

A fast, lightweight, secure online clipboard and file exchange application. Built with zero external paid APIs, self-contained auto-expiring storage, rate-limiting protection, and an authentic tactile minimalist UI.

---

## Features

- **Multi-content Support**:
  - Raw text, code snippets, links, credentials, formatted notes.
  - Files of **any format**: PDF, video (MP4, WebM, etc.), audio (MP3, WAV, etc.), images (PNG, JPEG, SVG, WebP), ZIP/archives, docs.
- **Instant Retrieval**:
  - Clear, large 6-digit retrieval code.
  - 1-click shareable direct link (with auto-fetch on load).
  - 1-click QR Code generated locally without external services.
- **In-Browser Previews & Fast Downloads**:
  - Native media players for video and audio.
  - Image light previews and PDF preview viewers.
  - Direct 1-click download with preserved original filenames.
  - 1-click text copy and text save-as `.txt`.
- **Security & Ephemerality**:
  - Configurable expiration (10 minutes or 1 hour).
  - "Burn after reading" (self-destructs immediately upon initial pickup).
  - Optional access passcode (scrypt cryptographic key derivation).
  - Anti brute-force rate limiter on retrieval endpoints.
  - Automatic background garbage collector running every 60 seconds to prune expired files from disk.
- **No AI-Generated Design Footprints**:
  - Purposeful, tactile dark slate/carbon palette with architectural amber accents.
  - Zero neon purple-indigo gradients, zero generic stock layouts, zero emojis, zero fake marketing fluff.
- **100% Free Lifetime Operation**:
  - No database subscription (self-contained atomic store with zero native compilation requirements).
  - Works out of the box on free hosting tiers like Render, Railway, Fly.io, or any VPS.

---

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open in your browser:
   ```
   http://localhost:3000
   ```

---

## Free Deployment (Render)

Render provides a 100% free web service tier that works seamlessly with this app.

### Method 1: Deploy with Git (Recommended)

1. Push this repository to GitHub or GitLab.
2. Sign in to [Render.com](https://render.com) (free account).
3. Click **New +** &rarr; **Web Service**.
4. Connect your repository.
5. Set the settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
6. Add environment variables (optional):
   - `MAX_FILE_SIZE_MB`: `50` (or your preferred size limit)
7. Click **Deploy Web Service**.

Your online clipboard will now be live at `https://your-app-name.onrender.com`.

### Method 2: Deploy with Docker

Use the included `Dockerfile` on any container platform (Railway, Fly.io, Koyeb, or self-hosted Docker):

```bash
docker build -t online-clipboard .
docker run -p 3000:3000 online-clipboard
```

---

## Configuration

Available environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for the HTTP server |
| `MAX_FILE_SIZE_MB` | `50` | Maximum upload size per session in MB |
| `NODE_ENV` | `production` | Node environment |
