// Chuẩn bị Mindmate cho DCMS: workspace "dcms", AGENTS.md, đăng ký MCP kho tri thức. Chạy: npm run mindmate:setup
import { mindmateConfig } from '../src/appConfig';
import { ensureSetup, resolveModel } from '../src/services/mindmate';
import { prisma } from '../src/core';

ensureSetup()
  .then(async (workspaceId) => {
    console.log(`✔ Workspace "${mindmateConfig.workspaceName}": ${workspaceId}`);
    console.log(`✔ MCP "${mindmateConfig.mcp.name}" → ${mindmateConfig.mcp.url}`);
    console.log(`✔ AGENTS.md: ${mindmateConfig.agentsMdPath}`);
    console.log(`✔ Model: ${await resolveModel()}`);
  })
  .catch((e) => {
    console.error('✘ Thiết lập Mindmate thất bại:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
