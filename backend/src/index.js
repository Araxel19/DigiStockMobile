/* Simple Express backend for testing n8n progress notifications
   Endpoints:
   - POST /api/v1/inventory/notify-progress  : accepts { planillaId, status, progress, message, downloadUrl }
   - GET  /api/v1/inventory/:planillaId/progress: returns latest state for given planillaId
*/

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// In-memory store for progress by planillaId
const store = new Map();

// POST notify-progress
app.post('/api/v1/inventory/notify-progress', (req, res) => {
  const { planillaId, status, progress, message, downloadUrl } = req.body || {};
  if (!planillaId) return res.status(400).json({ success: false, message: 'planillaId is required' });

  const prev = store.get(planillaId) || { planillaId, status: 'processing', progress: 0, message: '' };
  const next = {
    planillaId,
    status: status ?? prev.status,
    progress: typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : prev.progress,
    message: message ?? prev.message,
    downloadUrl: downloadUrl ?? prev.downloadUrl,
    updatedAt: new Date().toISOString(),
  };

  store.set(planillaId, next);
  console.log('notify-progress:', next);

  return res.json({ success: true, stored: next });
});

// GET progress
app.get('/api/v1/inventory/:planillaId/progress', (req, res) => {
  const { planillaId } = req.params;
  if (!planillaId) return res.status(400).json({ success: false, message: 'planillaId required' });

  const data = store.get(planillaId);
  if (!data) return res.status(404).json({ success: false, message: 'not found' });

  return res.json({ success: true, ...data });
});

// Simple health
app.get('/health', (_req, res) => res.json({ ok: true, now: new Date().toISOString() }));

app.listen(PORT, () => console.log(`digistock-backend listening on port ${PORT}`));
