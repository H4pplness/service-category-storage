// Điểm khởi động service kho tri thức: HTTP (MCP + API quản trị) + lịch đồng bộ Confluence.
import { getConfig } from './config';
import { createApp, createContext, scheduleJobs } from './app';
import { MCP_SERVER_NAME } from './mcp';

const cfg = getConfig();
const ctx = createContext(cfg);
ctx.store.abandonRunningRuns();

createApp(ctx).listen(cfg.port, () => {
  console.log(`DCMS Knowledge đang chạy tại http://localhost:${cfg.port}`);
  console.log(`  MCP (${MCP_SERVER_NAME}): POST http://localhost:${cfg.port}${cfg.mcp.path}`);
  console.log(`  Confluence ${cfg.confluence.type}: ${cfg.confluence.baseUrl} – spaces: ${cfg.confluence.spaces.map((s) => s.key).join(', ') || '(chưa cấu hình)'}`);
  console.log(`  Lịch đồng bộ: "${cfg.sync.cron}", đối soát: "${cfg.sync.reconcileCron}"`);
});

scheduleJobs(ctx);
if (cfg.sync.runOnStartup) void ctx.sync.run('auto').catch((e) => console.error('[sync]', e));
