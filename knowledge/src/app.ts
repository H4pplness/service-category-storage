// Khởi tạo các thành phần và HTTP app (MCP + API quản trị).
import express, { NextFunction, Request, Response } from 'express';
import cron from 'node-cron';
import { AppConfig } from './config';
import { ConfluenceClient } from './confluence';
import { KnowledgeStore } from './db';
import { mcpHandler } from './mcp';
import { SearchService } from './search';
import { SyncMode, SyncService } from './sync';

export interface Context {
  cfg: AppConfig;
  store: KnowledgeStore;
  client: ConfluenceClient;
  sync: SyncService;
  search: SearchService;
}

export function createContext(cfg: AppConfig): Context {
  const store = new KnowledgeStore(cfg.storagePath);
  const client = new ConfluenceClient(cfg.confluence);
  return { cfg, store, client, sync: new SyncService(store, client, cfg), search: new SearchService(store, cfg) };
}

function bearer(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!token) return next();
    const h = req.headers.authorization ?? '';
    if (h === `Bearer ${token}`) return next();
    res.status(401).json({ message: 'Thiếu hoặc sai token xác thực' });
  };
}

export function createApp(ctx: Context) {
  const { cfg, store, sync, search } = ctx;
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ───── MCP (Streamable HTTP) ─────
  app.post(cfg.mcp.path, bearer(cfg.mcp.authToken), mcpHandler(ctx));
  // Server chạy stateless: không hỗ trợ luồng GET/DELETE theo session
  app.all(cfg.mcp.path, (_req, res) =>
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }),
  );

  // ───── API quản trị ─────
  app.get('/api/health', (_req, res) => res.json({ status: 'UP' }));
  const admin = express.Router();
  admin.use(bearer(cfg.adminToken));
  admin.get('/status', (_req, res) => {
    const counts = store.countBySpace();
    res.json({
      running: sync.running,
      confluence: { type: cfg.confluence.type, baseUrl: cfg.confluence.baseUrl },
      schedule: { cron: cfg.sync.cron, reconcileCron: cfg.sync.reconcileCron },
      spaces: cfg.confluence.spaces.map((s) => ({ ...s, pages: counts[s.key] ?? 0, ...store.getState(s.key) })),
      runs: store.recentRuns(10),
    });
  });
  admin.post('/sync', async (req, res, next) => {
    const mode = (['auto', 'full', 'reconcile'].includes(String(req.query.mode)) ? req.query.mode : 'auto') as SyncMode;
    const p = sync.run(mode);
    if (req.query.wait === 'true') return p.then((r) => res.json(r)).catch(next);
    p.catch(() => undefined);
    res.status(202).json({ message: `Đã kích hoạt đồng bộ (${mode})` });
  });
  admin.get('/search', (req, res) => {
    res.json(search.search(String(req.query.q ?? ''), { limit: Number(req.query.limit) || undefined, space: (req.query.space as string) || undefined }));
  });
  admin.get('/pages/:id', (req, res) => {
    const p = store.getPage(req.params.id);
    if (!p) return res.status(404).json({ message: 'Không có trang này' });
    res.json(p);
  });
  app.use('/api', admin);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ message: err?.message ?? 'Lỗi hệ thống' });
  });
  return app;
}

/** Lên lịch đồng bộ định kỳ theo cấu hình */
export function scheduleJobs(ctx: Context) {
  const { cfg, sync } = ctx;
  for (const [name, expr] of [
    ['sync.cron', cfg.sync.cron],
    ['sync.reconcile-cron', cfg.sync.reconcileCron],
  ]) {
    if (!cron.validate(expr)) throw new Error(`Biểu thức cron không hợp lệ ở ${name}: "${expr}"`);
  }
  const tasks = [
    cron.schedule(cfg.sync.cron, () => void sync.run('auto').catch((e) => console.error('[sync]', e)), { name: 'confluence-sync' }),
    cron.schedule(cfg.sync.reconcileCron, () => void sync.run('reconcile').catch((e) => console.error('[sync]', e)), {
      name: 'confluence-reconcile',
    }),
  ];
  return () => tasks.forEach((t) => t.stop());
}
