# theia-agent

AI-powered browser assistant for blind users.

## Local development

### 1. Add your API key

Create a `.env` file in the project root (copy from `.env.example`):
```
GOOGLE_API_KEY=your_api_key_here
```
Get your key from [Google AI Studio](https://aistudio.google.com/apikey).

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Start the backend

```bash
uvicorn server:app --port 8000 --reload
```

The server runs at `http://localhost:8000`.

### 4. Load the extension

Go to `chrome://extensions` → Enable Developer mode → Load unpacked → select the `extension/` folder.

---

## Cloud Run deployment

### Prerequisites
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and logged in
- Docker installed and running

### Deploy

```bash
GOOGLE_API_KEY=your_api_key_here ./deploy.sh
```

This builds the Docker image via Cloud Build and deploys to Cloud Run in `us-central1`.

### Point the extension at the deployed backend

After deploying, update `extension/background.js` line 12:
```js
const BACKEND = 'https://your-service-url.run.app';
```

Then reload the extension at `chrome://extensions`.

---

## Architecture

```
Chrome Extension (sidebar + content script)
        │  voice command + screenshot
        ▼
  Cloud Run backend (server.py)
        │
        ▼
  Google ADK multi-agent pipeline
    ├── Router Agent        — routes to orientation or action
    ├── Orientation Agent   — describes the page in spoken language
    ├── Actor Agent         — decides what to click/type/scroll
    ├── Grounder Agent      — finds pixel coordinates of target element
    └── Action Loop         — retries failed actions up to 3 times
```
