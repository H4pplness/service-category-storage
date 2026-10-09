// Trợ lý Mindmate: trạng thái, danh sách hội thoại của người dùng, lịch sử, gửi tin nhắn (chuyển tiếp SSE từ Mindmate)
import { Request, Response, Router } from 'express';
import { ah, bad, notFound, prisma } from '../core';
import { mindmateConfig } from '../appConfig';
import { createConversation, ensureSetup, getHistory, streamMessage } from '../services/mindmate';

export const assistantRouter = Router();

const MAX_MESSAGE_LENGTH = 8000;
// Mỗi hội thoại chỉ xử lý 1 lượt tại một thời điểm (Mindmate không tự chặn lượt chạy đồng thời)
const busy = new Set<string>();

const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 57) + '…' : t || 'Hội thoại mới';
};

async function ownConversation(req: Request) {
  const c = await prisma.assistantConversation.findUnique({ where: { id: req.params.id } });
  if (!c || c.userId !== req.user.id) throw notFound('Hội thoại');
  return c;
}

assistantRouter.get(
  '/assistant/status',
  ah(async (_req, res) => {
    if (!mindmateConfig.enabled) return res.json({ enabled: false, ready: false });
    try {
      await ensureSetup();
      res.json({ enabled: true, ready: true });
    } catch (e) {
      res.json({ enabled: true, ready: false, message: (e as Error).message });
    }
  }),
);

assistantRouter.get(
  '/assistant/conversations',
  ah(async (req, res) => {
    const items = await prisma.assistantConversation.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    res.json(items.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt })));
  }),
);

assistantRouter.post(
  '/assistant/conversations',
  ah(async (req, res) => {
    const title = titleFrom(String(req.body?.title ?? ''));
    const id = await createConversation(title);
    const c = await prisma.assistantConversation.create({ data: { id, userId: req.user.id, title } });
    res.json({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt });
  }),
);

assistantRouter.delete(
  '/assistant/conversations/:id',
  ah(async (req, res) => {
    await ownConversation(req);
    // Chỉ gỡ khỏi danh sách của người dùng DCMS; lịch sử vẫn lưu ở Mindmate
    await prisma.assistantConversation.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

assistantRouter.get(
  '/assistant/conversations/:id/messages',
  ah(async (req, res) => {
    const c = await ownConversation(req);
    res.json({ id: c.id, title: c.title, busy: busy.has(c.id), messages: await getHistory(c.id) });
  }),
);

/** Gửi tin nhắn: phản hồi là luồng text/event-stream nguyên dạng từ Mindmate */
assistantRouter.post(
  '/assistant/conversations/:id/messages',
  ah(async (req: Request, res: Response) => {
    const c = await ownConversation(req);
    const text = String(req.body?.content ?? '').trim();
    if (!text) throw bad('Vui lòng nhập nội dung câu hỏi');
    if (text.length > MAX_MESSAGE_LENGTH) throw bad(`Câu hỏi tối đa ${MAX_MESSAGE_LENGTH} ký tự`);
    if (busy.has(c.id)) throw bad('Trợ lý đang trả lời câu hỏi trước trong hội thoại này, vui lòng đợi');

    busy.add(c.id);
    const abort = new AbortController();
    // Người dùng đóng kết nối (đóng chat / bấm dừng) → huỷ luồng tới Mindmate
    res.on('close', () => abort.abort());
    try {
      const upstream = await streamMessage(c.id, text, abort.signal);
      await prisma.assistantConversation.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          const message = `Mất kết nối tới Mindmate: ${(e as Error).message}`;
          res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`);
        }
      }
      res.end();
    } catch (e) {
      if (abort.signal.aborted) return;
      throw e;
    } finally {
      busy.delete(c.id);
    }
  }),
);
