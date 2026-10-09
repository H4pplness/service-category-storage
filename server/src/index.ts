import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { HttpError } from './core';
import { requireAuth } from './auth';
import { commonRouter, publicRouter } from './routes/common';
import { catalogRouter } from './routes/catalog';
import { configRouter } from './routes/config';
import { ticketRouter } from './routes/tickets';
import { taskRouter } from './routes/tasks';
import { dashboardRouter } from './routes/dashboard';
import { assistantRouter } from './routes/assistant';
import { TASK_LIMITS } from '../../shared/constants';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api', publicRouter);
app.use('/api', requireAuth, commonRouter, catalogRouter, configRouter, ticketRouter, taskRouter, dashboardRouter, assistantRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API không tồn tại')));

// Phục vụ bản build giao diện (npm start)
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, fieldErrors: err.fieldErrors });
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Dung lượng mỗi file tối đa ${TASK_LIMITS.maxFileSize / 1024 / 1024}MB`
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Tối đa ${TASK_LIMITS.maxFiles} file`
          : err.message;
    return res.status(400).json({ message: msg });
  }
  if (err?.code === 'P2025') return res.status(404).json({ message: 'Bản ghi không tồn tại' });
  console.error(err);
  res.status(500).json({ message: 'Lỗi hệ thống: ' + (err?.message || 'không xác định') });
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => console.log(`DCMS API đang chạy tại http://localhost:${PORT}`));
