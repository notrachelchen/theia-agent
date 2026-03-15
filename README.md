# theia-agent

AI-powered browser assistant for blind users.

## Backend setup

1. **Create a `.env` file** in the project root (copy from `.env.example`):
   ```
   GOOGLE_API_KEY=your_api_key_here
   ```
   Get your API key from [Google AI Studio](https://aistudio.google.com/apikey).

2. **Start the backend** (from project root):
   ```bash
   PYTHONPATH=backend adk api_server backend
   ```
   The server runs at `http://localhost:8000`.

## Extension

Load the `extension/` folder in Chrome via `chrome://extensions` → Load unpacked.
