import { PoolClient } from 'pg';
import { query } from './db';

export interface AuditEntry {
  entityType: string;
  entityId: number;
  action: string;
  reason?: string;
  actor?: string;
  courseId?: number | null;
  studentId?: number | null;
  meta?: Record<string, any>;
}

/** 所有关键业务动作（请假/停课/转班/材料消耗/退费/补课...）都会写入流水，供档案页与报名时间线查询 */
export async function audit(e: AuditEntry, client?: PoolClient) {
  const sql = `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, student_id, meta)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`;
  const params = [
    e.entityType,
    e.entityId,
    e.action,
    e.reason ?? '',
    e.actor ?? '系统',
    e.courseId ?? null,
    e.studentId ?? null,
    JSON.stringify(e.meta ?? {}),
  ];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}
