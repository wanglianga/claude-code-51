import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { pool } from './db';
import { seedIfEmpty } from './seed';
import { requireAuth } from './auth';
import { authRouter, coreRouter } from './routes/core';
import { coursesRouter } from './routes/courses';
import { sessionsRouter, materialsRouter } from './routes/sessions';
import {
  enrollmentsRouter,
  leavesRouter,
  makeupsRouter,
  refundsRouter,
  transfersRouter,
} from './routes/enrollments';
import { eventsRouter } from './routes/events';
import { offersRouter } from './routes/offers';
import { analysisRouter } from './routes/analysis';

async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      console.log(`[boot] 等待数据库就绪... (${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('数据库连接失败');
}

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(schema);
  console.log('[boot] 数据库结构就绪');
}

async function main() {
  await waitForDb();
  await migrate();
  await seedIfEmpty();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 健康检查（供 Docker HEALTHCHECK 与 compose 探活）
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, service: 'senior-university', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use('/api/auth', authRouter);
  // 以下接口均需登录（coreRouter 内含 /meta/options、/students、/teachers、/rooms）
  app.use('/api', requireAuth, coreRouter);
  app.use('/api/courses', requireAuth, coursesRouter);
  app.use('/api/sessions', requireAuth, sessionsRouter);
  app.use('/api/materials', requireAuth, materialsRouter);
  app.use('/api/enrollments', requireAuth, enrollmentsRouter);
  app.use('/api/leave-requests', requireAuth, leavesRouter);
  app.use('/api/makeups', requireAuth, makeupsRouter);
  app.use('/api/refunds', requireAuth, refundsRouter);
  app.use('/api/transfers', requireAuth, transfersRouter);
  app.use('/api/events', requireAuth, eventsRouter);
  app.use('/api/offers', requireAuth, offersRouter);
  app.use('/api/analysis', requireAuth, analysisRouter);

  // 生产模式：托管前端构建产物（SPA 回退）
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(publicDir, 'index.html'));
      } else {
        next();
      }
    });
  }

  // 统一错误处理
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err);
    if (err?.code === '23505') return res.status(400).json({ error: '数据重复（唯一约束冲突）' });
    res.status(err?.status || 500).json({ error: err?.message || '服务器内部错误' });
  });

  app.listen(config.port, () => {
    console.log(`[boot] 服务已启动: http://0.0.0.0:${config.port}`);
  });
}

main().catch((e) => {
  console.error('[boot] 启动失败', e);
  process.exit(1);
});
