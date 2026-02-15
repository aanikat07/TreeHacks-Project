## Animation Pipeline (Claude -> Render Worker -> Vercel Blob)

This app now supports an async animation flow in the `Animation` tab:

1. User prompt goes to `POST /api/chat` with `mode: "animation"`.
2. Claude generates Python Manim code.
3. The app creates a render job in Blob (`manim-jobs/...json`).
4. The app enqueues your Render worker.
5. Worker renders video and calls `POST /api/animation/callback`.
6. Callback stores video in Blob (`manim-renders/<jobId>.mp4`) and marks the job completed.
7. Frontend polls `GET /api/animation/jobs/[id]` and displays the video.

### Required env vars (Next app)

Add these to `.env.local`:

```bash
ANTHROPIC_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
RENDER_WORKER_URL=https://your-render-worker.onrender.com
RENDER_WORKER_SECRET=your-shared-secret
RENDER_CALLBACK_SECRET=your-callback-secret
# optional if callback origin differs from request origin
# RENDER_CALLBACK_URL=https://your-app-domain.com/api/animation/callback
```

### Worker scaffold

Worker code is in `worker/render_worker.py`.

Expected deployment env var for worker:

```bash
RENDER_WORKER_SECRET=your-shared-secret
```

Deploy on Render with:

1. Runtime: Python
2. Build command: `pip install -r worker/requirements.txt`
3. Start command: `python worker/render_worker.py`

### Run locally

```bash
npm run dev
```
