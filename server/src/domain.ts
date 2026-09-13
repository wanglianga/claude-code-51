import { PoolClient } from 'pg';
import { query, one } from './db';
import { audit } from './audit';
import { weeklyDates, currentYear } from './helpers';

/** 报名年龄规则：老年大学 50-85 岁，舞蹈类课程因身体要求上限 80 岁 */
export const AGE_MIN = 50;
export const AGE_MAX = 85;
export const DANCE_AGE_MAX = 80;
/** 候补人数达到该值视为热门课程，禁止手工插队 */
export const HOT_WAITLIST_THRESHOLD = 3;
/** 转正通知确认时限（小时） */
export const OFFER_EXPIRE_HOURS = 48;

/** 计算课程已录取人数 */
export async function confirmedCount(courseId: number, client?: PoolClient): Promise<number> {
  const sql = `SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='已录取'`;
  const row = client
    ? (await client.query(sql, [courseId])).rows[0]
    : await one(sql, [courseId]);
  return row?.c ?? 0;
}

/** 生成课次：自 start_date 起每周一次 */
export async function generateSessions(course: any, client?: PoolClient) {
  const dates = weeklyDates(course.start_date, course.total_sessions);
  const run = async (text: string, params: any[]): Promise<any[]> =>
    client ? (await client.query(text, params)).rows : query(text, params);
  for (let i = 0; i < dates.length; i++) {
    const rows = await run(
      `INSERT INTO course_sessions(course_id, session_no, session_date, start_time, end_time, room_id, teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [course.id, i + 1, dates[i], course.start_time, course.end_time, course.room_id, course.teacher_id]
    );
    const sid = rows[0].id;
    await run(
      `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
       VALUES($1,'课程',$2,$3,$4,$5,$6)`,
      [course.room_id, sid, `${course.title} 第${i + 1}次课`, dates[i], course.start_time, course.end_time]
    );
  }
}

/** 检查教室在某日期时段是否已被占用 */
export async function roomConflict(
  roomId: number,
  date: string,
  start: string,
  end: string,
  client?: PoolClient
): Promise<string | null> {
  const sql = `SELECT title FROM room_bookings
               WHERE room_id=$1 AND booking_date=$2 AND NOT (end_time<=$3 OR start_time>=$4) LIMIT 1`;
  const row = client
    ? (await client.query(sql, [roomId, date, start, end])).rows[0]
    : await one(sql, [roomId, date, start, end]);
  return row ? row.title : null;
}

/** 课程上课日期范围 [首日, 末日] */
export function courseRange(course: any): [string, string] {
  const dates = weeklyDates(course.start_date, course.total_sessions);
  return [dates[0], dates[dates.length - 1]];
}

/** 兴趣班冲突检测：同学员已录取/长期请假课程中，与目标课程同星期、时段重叠且日期范围重叠者 */
export async function findTimeConflict(
  studentId: number,
  targetCourse: any,
  client?: PoolClient
): Promise<any | null> {
  const sql = `SELECT c.* FROM enrollments e JOIN courses c ON c.id=e.course_id
               WHERE e.student_id=$1 AND e.status IN ('已录取','长期请假') AND c.id<>$2
                 AND c.status IN ('报名中','已开班')`;
  const rows = client
    ? (await client.query(sql, [studentId, targetCourse.id])).rows
    : await query(sql, [studentId, targetCourse.id]);
  const [tStart, tEnd] = courseRange(targetCourse);
  for (const c of rows) {
    if (c.weekday !== targetCourse.weekday) continue;
    if (c.end_time <= targetCourse.start_time || c.start_time >= targetCourse.end_time) continue;
    const [cStart, cEnd] = courseRange(c);
    if (cEnd < tStart || cStart > tEnd) continue;
    return c;
  }
  return null;
}

/** 分配座位号：课程容量内最小空闲号，无空位返回 null */
export async function assignSeat(courseId: number, client?: PoolClient): Promise<number | null> {
  const run = async <T = any>(text: string, params?: any[]): Promise<T[]> =>
    client ? (await client.query(text, params)).rows : query<T>(text, params);
  const course = (await run<any>(`SELECT capacity FROM courses WHERE id=$1`, [courseId]))[0];
  if (!course) return null;
  const used = new Set(
    (
      await run<any>(
        `SELECT seat_no FROM enrollments WHERE course_id=$1 AND status='已录取' AND seat_no IS NOT NULL`,
        [courseId]
      )
    ).map((r) => r.seat_no)
  );
  for (let i = 1; i <= course.capacity; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

/** 候补候选人名单：按候补顺序，标注时间冲突/已顺延记录/待确认通知，给出是否可推送 */
export async function waitlistCandidates(courseId: number, client?: PoolClient) {
  const run = async <T = any>(text: string, params?: any[]): Promise<T[]> =>
    client ? (await client.query(text, params)).rows : query<T>(text, params);
  const course = (await run<any>(`SELECT * FROM courses WHERE id=$1`, [courseId]))[0];
  if (!course) return [];
  const rows = await run<any>(
    `SELECT e.*, s.name AS student_name FROM enrollments e JOIN students s ON s.id=e.student_id
     WHERE e.course_id=$1 AND e.status='候补' ORDER BY e.waitlist_position NULLS LAST, e.id`,
    [courseId]
  );
  const out = [];
  for (const en of rows) {
    const conflict = await findTimeConflict(en.student_id, course, client);
    const declined = (
      await run<any>(
        `SELECT reason, status FROM promotion_offers WHERE enrollment_id=$1 AND status IN ('已顺延','已过期')
         ORDER BY id DESC LIMIT 1`,
        [en.id]
      )
    )[0];
    const pending = (
      await run<any>(`SELECT id FROM promotion_offers WHERE enrollment_id=$1 AND status='待确认'`, [en.id])
    )[0];
    out.push({
      enrollment: en,
      timeConflict: conflict
        ? { title: conflict.title, weekday: conflict.weekday, start_time: conflict.start_time, end_time: conflict.end_time }
        : null,
      declinedBefore: declined ? declined.reason || declined.status : '',
      hasPendingOffer: !!pending,
      eligible: !conflict && !declined && !pending,
    });
  }
  return out;
}

/** 将本课程过期的待确认通知标记为已过期（保留原因） */
async function expireOffersRaw(courseId: number, client?: PoolClient) {
  const sql = `UPDATE promotion_offers SET status='已过期', reason='超过48小时未确认，自动顺延', responded_at=now()
               WHERE course_id=$1 AND status='待确认' AND expires_at < now()`;
  if (client) await client.query(sql, [courseId]);
  else await query(sql, [courseId]);
}

/**
 * 按候补顺序、可上课时间推送转正通知（基础水平随通知快照展示）。
 * 每出现一个空位推送一位；已被顺延/过期、时间冲突、已有待确认通知者自动跳过（原因保留可查）。
 */
export async function offerNextSeats(
  courseId: number,
  actor: string,
  note: string,
  client?: PoolClient
): Promise<any[]> {
  const run = async <T = any>(text: string, params?: any[]): Promise<T[]> =>
    client ? (await client.query(text, params)).rows : query<T>(text, params);
  await expireOffersRaw(courseId, client);
  const course = (await run<any>(`SELECT * FROM courses WHERE id=$1`, [courseId]))[0];
  if (!course || !['报名中', '已开班'].includes(course.status)) return [];
  const confirmed = await confirmedCount(courseId, client);
  const pending = (
    await run<any>(
      `SELECT COUNT(*)::int AS c FROM promotion_offers WHERE course_id=$1 AND status='待确认'`,
      [courseId]
    )
  )[0].c;
  let needed = course.capacity - confirmed - pending;
  if (needed <= 0) return [];

  const candidates = await waitlistCandidates(courseId, client);
  const created: any[] = [];
  for (const cand of candidates) {
    if (needed <= 0) break;
    if (!cand.eligible) continue;
    const en = cand.enrollment;
    const rows = await run<any>(
      `INSERT INTO promotion_offers(course_id, enrollment_id, student_id, queue_position, level, note, offered_by, expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7, now() + INTERVAL '48 hours') RETURNING *`,
      [courseId, en.id, en.student_id, en.waitlist_position, en.level, note, actor]
    );
    await audit(
      {
        entityType: 'offer',
        entityId: rows[0].id,
        action: '推送转正通知',
        reason: `${note}；候补第${en.waitlist_position}位，基础水平：${en.level}`,
        actor,
        courseId,
        studentId: en.student_id,
      },
      client
    );
    created.push(rows[0]);
    needed--;
  }
  return created;
}

/** 全局过期处理（列表/总览前调用），过期后自动为对应课程顺延下一位 */
export async function expireStaleOffersGlobal() {
  const rows = await query<any>(
    `UPDATE promotion_offers SET status='已过期', reason='超过48小时未确认，自动顺延', responded_at=now()
     WHERE status='待确认' AND expires_at < now() RETURNING course_id`
  );
  const ids = [...new Set(rows.map((r) => r.course_id))];
  for (const cid of ids) {
    await offerNextSeats(cid as number, '系统', '前序通知过期自动顺延');
  }
}

/** 结课时生成/刷新学员学习记录（出勤、补课、教师评价、退费、续报名建议） */
export async function generateLearningRecords(courseId: number, actor: string, client?: PoolClient) {
  const run = async <T = any>(text: string, params?: any[]): Promise<T[]> =>
    client ? (await client.query(text, params)).rows : query<T>(text, params);

  const course = (await run<any>(`SELECT * FROM courses WHERE id=$1`, [courseId]))[0];
  if (!course) throw new Error('课程不存在');

  const enrollments = await run<any>(
    `SELECT * FROM enrollments WHERE course_id=$1 AND status IN ('已录取','已转班')`,
    [courseId]
  );
  const totalSessions = (
    await run<any>(
      `SELECT COUNT(*)::int AS c FROM course_sessions WHERE course_id=$1 AND status<>'已停课'`,
      [courseId]
    )
  )[0].c;

  for (const en of enrollments) {
    const att = (
      await run<any>(
        `SELECT
           COUNT(*) FILTER (WHERE a.status='签到')::int AS attended,
           COUNT(*) FILTER (WHERE a.status='迟到')::int AS late,
           COUNT(*) FILTER (WHERE a.status='请假')::int AS leaves,
           COUNT(*) FILTER (WHERE a.status IN ('缺席','代签异常'))::int AS absent
         FROM attendances a JOIN course_sessions s ON s.id=a.session_id
         WHERE a.enrollment_id=$1 AND s.course_id=$2`,
        [en.id, courseId]
      )
    )[0];
    const makeupDone = (
      await run<any>(
        `SELECT COUNT(*)::int AS c FROM makeups WHERE enrollment_id=$1 AND status='已完成'`,
        [en.id]
      )
    )[0].c;
    const ev = (
      await run<any>(`SELECT * FROM evaluations WHERE enrollment_id=$1 AND course_id=$2`, [
        en.id,
        courseId,
      ])
    )[0];
    const refundTotal = (
      await run<any>(
        `SELECT COALESCE(SUM(amount),0)::numeric(10,2) AS t FROM refunds
         WHERE enrollment_id=$1 AND status='已退费'`,
        [en.id]
      )
    )[0].t;

    const effective = att.attended + att.late;
    const rate = totalSessions > 0 ? Math.round((effective / totalSessions) * 1000) / 10 : 0;
    let suggestion: string;
    if (rate >= 85) suggestion = '出勤优秀，建议续报进阶课程';
    else if (rate >= 60) suggestion = '出勤良好，建议续报同水平课程';
    else suggestion = '出勤偏低，建议工作人员电话回访了解原因后再定';

    await run(
      `INSERT INTO learning_records(student_id, course_id, enrollment_id, term, total_sessions,
         attended, late, leaves, absent, makeup_done, attendance_rate,
         teacher_rating, teacher_comment, refund_total, reenroll_suggestion)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (enrollment_id) DO UPDATE SET
         total_sessions=EXCLUDED.total_sessions, attended=EXCLUDED.attended, late=EXCLUDED.late,
         leaves=EXCLUDED.leaves, absent=EXCLUDED.absent, makeup_done=EXCLUDED.makeup_done,
         attendance_rate=EXCLUDED.attendance_rate, teacher_rating=EXCLUDED.teacher_rating,
         teacher_comment=EXCLUDED.teacher_comment, refund_total=EXCLUDED.refund_total,
         reenroll_suggestion=EXCLUDED.reenroll_suggestion, generated_at=now()`,
      [
        en.student_id,
        courseId,
        en.id,
        course.term,
        totalSessions,
        att.attended,
        att.late,
        att.leaves,
        att.absent,
        makeupDone,
        rate,
        ev?.rating ?? null,
        ev?.comment ?? '',
        refundTotal,
        suggestion,
      ]
    );
  }
  await audit(
    {
      entityType: 'course',
      entityId: courseId,
      action: '生成学习记录',
      reason: `结课汇总：出勤/补课/教师评价/退费/续报名建议，共 ${enrollments.length} 名学员`,
      actor,
      courseId,
    },
    client
  );
}

export function ageOf(birthYear: number): number {
  return currentYear() - birthYear;
}
