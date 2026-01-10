# DigiStock Backend (stub)

Simple Express server to receive progress notifications and serve progress for a given `planillaId`.

## Install

```bash
cd backend
npm install
```

## Run

- Development (auto-restart):
  ```bash
  npm run dev
  ```

- Production:
  ```bash
  npm start
  ```

## Endpoints
- POST /api/v1/inventory/notify-progress
  - body: { planillaId, status, progress, message, downloadUrl }
  - stores state in memory

- GET /api/v1/inventory/:planillaId/progress
  - returns last stored status

This server is intentionally minimal and stores state in memory for quick local testing. For production use, replace with a proper persistence layer (DB).
