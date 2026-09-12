import { PoolClient } from 'pg';
import { query, one } from './db';
import { audit } from './audit';
import { weeklyDates, currentYear } from './helpers';

/** 计算课程已录取人数 */
export async function confirmedCount(courseId: number, client?: PoolClient): Promise<number> {
  const sql = `SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='已录取'`;
  const row = client
    ? (await client.query(sql, [courseId])).rows[0]
    : await one(sql, [courseId]);
  return row?.c ?? 0;
}

/** 候补转正：取候补队列第一位转为已录取 */
export async function promoteNext(courseId: number, actor: string, client?: PoolClient) {
  const run = async (q: <T = any>(t: string, p?: any[]) => Promise<T[]>) => {
    const next = (
      await q<any>(
        `SELECT * FROM enrollments WHERE course_id=$1 AND status='候补'
         ORDER BY waitlist_position NULLS LAST, id LIMIT 1`,
        [courseId]
      )
    )[0];
    if (!next) return null;
    await q(`UPDATE enrollments SET status='已录取', waitlist_position=NULL WHERE id=$1`, [next.id]);
    return next;
  };
  let promoted: any = null;
  if (client) {
    promoted = await run(async (t, p) => (await client.query(t, p)).rows);
  } else {
    promoted = await run((t, p) => query(t, p));
  }
  if (promoted) {
    await audit(
      {
        entityType: 'enrollment',
        entityId: promoted.id,
        action: '候补转正',
        reason: '课程出现空余名额，按候补顺序录取',
        actor,
        courseId,
        studentId: promoted.student_id,
      },
      client
    );
  }
  return promoted;
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
