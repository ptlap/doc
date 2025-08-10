# AI Worker Service

Worker tiêu thụ jobs từ Redis list `queue:document-processing` và xử lý tài liệu (placeholder).

Chạy local:

```
pnpm --filter @ai-doc-assistant/worker dev
```

Env:

- `REDIS_URL` (mặc định `redis://localhost:6379`)
- `QUEUE_KEY` (mặc định `queue:document-processing`)
- `WORKER_PORT` (mặc định `4001`)
