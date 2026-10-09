// MCP server (Streamable HTTP, stateless) – Mindmate gọi qua tool "mcp".
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppConfig } from './config';
import { KnowledgeStore } from './db';
import { formatHits, SearchService } from './search';
import { SyncService } from './sync';
import { truncate } from './text';

export const MCP_SERVER_NAME = 'dcms-knowledge';

export const MCP_SERVER_DESCRIPTION =
  'Kho tri thức Sản phẩm - Nghiệp vụ (SP-NV) của DCMS, đồng bộ hằng giờ từ Confluence. ' +
  'Mỗi SP-NV có mô tả "khi nào nên chọn". Dùng để xác định khách hàng/tình huống nên chọn sản phẩm - nghiệp vụ nào khi tạo phiếu. ' +
  'Tools: search_product_guidance (tìm ứng viên theo tình huống), get_product_guidance (đọc toàn văn trang), get_knowledge_status (trạng thái đồng bộ).';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });

export function buildMcpServer(deps: { store: KnowledgeStore; search: SearchService; sync: SyncService; cfg: AppConfig }): McpServer {
  const { store, search, cfg } = deps;
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '1.0.0' },
    { instructions: MCP_SERVER_DESCRIPTION },
  );

  server.registerTool(
    'search_product_guidance',
    {
      title: 'Tìm sản phẩm - nghiệp vụ phù hợp',
      description:
        'Tìm các sản phẩm - nghiệp vụ (SP-NV) phù hợp với tình huống/nhu cầu của khách hàng trong kho tri thức Confluence. ' +
        'Trả về danh sách ứng viên xếp hạng kèm phần "Khi nào nên chọn". Viết truy vấn bằng tiếng Việt (có dấu hoặc không), ' +
        'gồm tên sản phẩm và/hoặc nghiệp vụ và/hoặc mô tả vấn đề, ví dụ: "khách bị trừ tiền 2 lần khi thanh toán thẻ visa", "khóa thẻ ghi nợ do mất thẻ". ' +
        'Nếu kết quả chưa rõ, tìm lại với từ khoá khác hoặc đọc chi tiết bằng get_product_guidance.',
      inputSchema: {
        query: z.string().min(1).describe('Tình huống hoặc từ khoá cần tìm'),
        limit: z.number().int().min(1).max(cfg.search.maxLimit).optional().describe(`Số kết quả tối đa (mặc định ${cfg.search.defaultLimit})`),
        space: z.string().optional().describe('Giới hạn trong một Confluence space key (tuỳ chọn)'),
      },
    },
    async ({ query, limit, space }) => text(formatHits(query, search.search(query, { limit, space }))),
  );

  server.registerTool(
    'get_product_guidance',
    {
      title: 'Đọc chi tiết một sản phẩm - nghiệp vụ',
      description: 'Lấy toàn văn trang Confluence mô tả một sản phẩm - nghiệp vụ (theo page_id lấy từ search_product_guidance).',
      inputSchema: { page_id: z.string().min(1).describe('page_id của trang Confluence') },
    },
    async ({ page_id }) => {
      const p = store.getPage(String(page_id).trim());
      if (!p) return text(`Không có trang ${page_id} trong kho tri thức (có thể đã bị xoá hoặc chưa đồng bộ).`, true);
      const props = Object.entries(p.properties);
      const out = [
        `# ${p.title}`,
        `- page_id: ${p.id} · space: ${p.spaceKey} · phiên bản: ${p.version}${p.lastModified ? ` · cập nhật: ${p.lastModified}` : ''}${p.lastModifiedBy ? ` bởi ${p.lastModifiedBy}` : ''}`,
        p.path.length ? `- Thuộc: ${p.path.join(' › ')}` : '',
        p.labels.length ? `- Label: ${p.labels.join(', ')}` : '',
        `- Link: ${p.url}`,
        props.length ? `- Thuộc tính: ${props.map(([k, v]) => `${k}: ${v}`).join(' | ')}` : '',
        '',
        truncate(p.markdown, cfg.content.maxChars),
      ];
      return text(out.filter((l, i) => l !== '' || i > 5).join('\n'));
    },
  );

  server.registerTool(
    'get_knowledge_status',
    {
      title: 'Trạng thái kho tri thức',
      description: 'Xem các Confluence space đang được đồng bộ, số trang và thời điểm đồng bộ gần nhất.',
      inputSchema: {},
    },
    async () => {
      const counts = store.countBySpace();
      const lines = cfg.confluence.spaces.map((s) => {
        const st = store.getState(s.key);
        return `- ${s.key}: ${counts[s.key] ?? 0} trang · đồng bộ gần nhất: ${st.lastIncrementalAt ?? 'chưa'} · quét toàn bộ: ${st.lastFullAt ?? 'chưa'}`;
      });
      const last = store.recentRuns(1)[0];
      if (last) lines.push(`- Lần chạy gần nhất: #${last.id} ${last.status} lúc ${last.finishedAt ?? last.startedAt}`);
      return text(['Kho tri thức SP-NV:', ...lines].join('\n'));
    },
  );

  return server;
}

/** Handler Express cho POST /mcp – mỗi request tạo server + transport riêng (stateless) */
export function mcpHandler(deps: Parameters<typeof buildMcpServer>[0]) {
  return async (req: Request, res: Response) => {
    const server = buildMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp] lỗi xử lý request', e);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  };
}
