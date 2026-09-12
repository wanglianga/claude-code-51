import { Request, Response, NextFunction } from 'express';

/** 包装异步路由，统一走错误中间件 */
export const h =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export function bad(res: Response, msg: string, code = 400) {
  return res.status(code).json({ error: msg });
}

export function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(v: any, def = ''): string {
  return typeof v === 'string' ? v.trim() : def;
}

/** 把 Date/string 统一格式化为 YYYY-MM-DD */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 自 startDate 起每周一次，生成 n 个日期（兼容字符串与 Date 对象） */
export function weeklyDates(startDate: string | Date, n: number): string[] {
  const out: string[] = [];
  const d =
    startDate instanceof Date
      ? new Date(startDate.getTime())
      : new Date(startDate + 'T00:00:00');
  for (let i = 0; i < n; i++) {
    out.push(fmtDate(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

export function currentYear(): number {
  return new Date().getFullYear();
}
