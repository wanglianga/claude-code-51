import { Router } from 'express';
import { query, one, withTransaction } from '../db';
import { h, bad, str, num } from '../helpers';
import { requireStaff } from '../auth';
import { audit } from '../audit';
import { confirmedCount, promoteNext, ageOf } from '../domain';

export const enrollmentsRouter = Router();
export const leavesRouter = Router();
export const makeupsRouter = Router();
export const refundsRouter = Router();
export const transfersRouter = Router();

// ---------------- 报名 ----------------
enrollmentsRouter.get(
  '/',
  h(async (req, res) => {
    const courseId = num(req.query.course_id);
    const status = str(req.query.status as string);
    const kw = str(req.query.kw as string);
    const rows = await query(
      `SELECT e.*, s.name AS student_name, s.phone, c.title AS course_title, c.category, c.term
       FROM enrollments e
       JOIN students s ON s.id=e.student_id
       JOIN courses c ON c.id=e.course_id
       WHERE ($1::int IS NULL OR e.course_id=$1)
         AND ($2='' OR e.status=$2)
         AND ($3='' OR s.name ILIKE '%'||$3||'%' OR c.title ILIKE '%'||$3||'%')
       ORDER BY e.created_at DESC, e.id DESC LIMIT 500`,
      [courseId, status, kw]
    );
    res.json(rows);
  })
);

enrollmentsRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const studentId = num(req.body.student_id);
    const courseId = num(req.body.course_id);
    if (!studentId || !courseId) return bad(res, '请选择学员与课程');
    const student = await one<any>(`SELECT * FROM students WHERE id=$1`, [studentId]);
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [courseId]);
    if (!student || !course) return bad(res, '学员或课程不存在', 404);
    if (['已结课', '已取消'].includes(course.status)) return bad(res, `课程已${course.status}，不能报名`);
    const dup = await one(`SELECT id FROM enrollments WHERE student_id=$1 AND course_id=$2`, [studentId, courseId]);
    if (dup) return bad(res, '该学员已报名此课程');

    const result = await withTransaction(async (client) => {
      const confirmed = (
        await client.query(
          `SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='已录取'`,
          [courseId]
        )
      ).rows[0].c;
      let status = '已录取';
      let position: number | null = null;
      if (confirmed >= course.capacity) {
        status = '候补';
        position =
          (
            await client.query(
              `SELECT COALESCE(MAX(waitlist_position),0)::int AS p FROM enrollments WHERE course_id=$1 AND status='候补'`,
              [courseId]
            )
          ).rows[0].p + 1;
      }
      const r = await client.query(
        `INSERT INTO enrollments(student_id, course_id, age, level, health_limits, source, fee_amount, fee_status, status, waitlist_position)
         VALUES($1,$2,$3,$4,$5,$6,$7,'未缴',$8,$9) RETURNING *`,
        [
          studentId,
          courseId,
          ageOf(student.birth_year),
          str(req.body.level, '零基础'),
          str(req.body.health_limits) || student.health_limits,
          str(req.body.source) || student.source,
          course.fee,
          status,
          position,
        ]
      );
      await audit(
        {
          entityType: 'enrollment',
          entityId: r.rows[0].id,
          action: '学员报名',
          reason: status === '候补' ? `课程已满，进入候补队列第${position}位` : '报名并录取',
          actor: req.user!.name,
          courseId,
          studentId,
        },
        client
      );
      return r.rows[0];
    });
    res.json(result);
  })
);

// 缴费
enrollmentsRouter.post(
  '/:id/pay',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const en = await one<any>(`UPDATE enrollments SET fee_status='已缴' WHERE id=$1 RETURNING *`, [id]);
    if (!en) return bad(res, '报名记录不存在', 404);
    await audit({
      entityType: 'enrollment',
      entityId: id,
      action: '登记缴费',
      reason: `缴费 ${en.fee_amount} 元`,
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json(en);
  })
);

// 退课（已录取名额空出 → 自动候补转正；已缴费 → 自动生成退费申请）
enrollmentsRouter.post(
  '/:id/cancel',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const reason = str(req.body.reason) || '学员主动退课';
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [id]);
    if (!en) return bad(res, '报名记录不存在', 404);
    if (!['已录取', '候补'].includes(en.status)) return bad(res, `当前状态为「${en.status}」，不能退课`);

    await withTransaction(async (client) => {
      await client.query(`UPDATE enrollments SET status='已退课', waitlist_position=NULL WHERE id=$1`, [id]);
      await audit(
        {
          entityType: 'enrollment',
          entityId: id,
          action: '学员退课',
          reason,
          actor: req.user!.name,
          courseId: en.course_id,
          studentId: en.student_id,
        },
        client
      );
      if (en.fee_status === '已缴') {
        await client.query(
          `INSERT INTO refunds(enrollment_id, amount, reason_type, reason, status) VALUES($1,$2,'学员退课',$3,'待审核')`,
          [id, en.fee_amount, reason]
        );
      }
      if (en.status === '已录取') {
        await promoteNext(en.course_id, req.user!.name, client);
      }
    });
    res.json({ ok: true });
  })
);

// 候补转正（手动）
enrollmentsRouter.post(
  '/:id/promote',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [id]);
    if (!en) return bad(res, '报名记录不存在', 404);
    if (en.status !== '候补') return bad(res, '仅候补状态可转正');
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [en.course_id]);
    const confirmed = await confirmedCount(en.course_id);
    const overrideReason = str(req.body.override_reason);
    if (confirmed >= course.capacity && !overrideReason) {
      return res.status(409).json({ error: '课程已满，如需破格录取请填写原因（如扩班）' });
    }
    await one(`UPDATE enrollments SET status='已录取', waitlist_position=NULL WHERE id=$1`, [id]);
    await audit({
      entityType: 'enrollment',
      entityId: id,
      action: '候补转正',
      reason: overrideReason ? `破格录取：${overrideReason}` : '工作人员手动转正',
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json({ ok: true });
  })
);

// 报名时间线：请假/停课/转班/材料消耗/退费/补课原因一览（处理退费、补课、续报时溯源）
enrollmentsRouter.get(
  '/:id/timeline',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const en = await one<any>(
      `SELECT e.*, s.name AS student_name, c.title AS course_title, c.term
       FROM enrollments e JOIN students s ON s.id=e.student_id JOIN courses c ON c.id=e.course_id
       WHERE e.id=$1`,
      [id]
    );
    if (!en) return bad(res, '报名记录不存在', 404);
    const [attendances, leaves, makeups, refunds, transfers, audits, materialLogs, cancelledSessions] =
      await Promise.all([
        query(
          `SELECT a.*, s.session_no, s.session_date::text, s.is_makeup_session FROM attendances a
           JOIN course_sessions s ON s.id=a.session_id WHERE a.enrollment_id=$1 ORDER BY s.session_date`,
          [id]
        ),
        query(`SELECT * FROM leave_requests WHERE enrollment_id=$1 ORDER BY created_at`, [id]),
        query(`SELECT * FROM makeups WHERE enrollment_id=$1 ORDER BY created_at`, [id]),
        query(`SELECT * FROM refunds WHERE enrollment_id=$1 ORDER BY created_at`, [id]),
        query(
          `SELECT t.*, cf.title AS from_title, ct.title AS to_title FROM transfers t
           JOIN courses cf ON cf.id=t.from_course_id JOIN courses ct ON ct.id=t.to_course_id
           WHERE t.enrollment_id=$1 OR t.new_enrollment_id=$1`,
          [id]
        ),
        query(
          `SELECT * FROM audit_logs WHERE (entity_type='enrollment' AND entity_id=$1)
             OR (student_id=$2 AND course_id=$3) ORDER BY created_at`,
          [id, en.student_id, en.course_id]
        ),
        query(
          `SELECT ml.*, m.name AS material_name, m.unit FROM material_logs ml
           JOIN materials m ON m.id=ml.material_id WHERE m.course_id=$1 ORDER BY ml.created_at`,
          [en.course_id]
        ),
        query(
          `SELECT session_no, session_date::text, cancel_reason FROM course_sessions
           WHERE course_id=$1 AND status='已停课' ORDER BY session_date`,
          [en.course_id]
        ),
      ]);
    res.json({ enrollment: en, attendances, leaves, makeups, refunds, transfers, audits, materialLogs, cancelledSessions });
  })
);

// 教师评价（ upsert ）
enrollmentsRouter.put(
  '/:id/evaluation',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const rating = num(req.body.rating);
    const comment = str(req.body.comment);
    if (!rating || rating < 1 || rating > 5) return bad(res, '评分需为1-5');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [id]);
    if (!en) return bad(res, '报名记录不存在', 404);
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [en.course_id]);
    const r = await one<any>(
      `INSERT INTO evaluations(enrollment_id, course_id, teacher_id, rating, comment)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (enrollment_id, course_id) DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment
       RETURNING *`,
      [id, en.course_id, course.teacher_id, rating, comment]
    );
    await audit({
      entityType: 'enrollment',
      entityId: id,
      action: '教师评价',
      reason: `评分${rating}：${comment}`,
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json(r);
  })
);

// ---------------- 请假 ----------------
leavesRouter.get(
  '/',
  h(async (req, res) => {
    const status = str(req.query.status as string);
    const rows = await query(
      `SELECT lr.*, st.name AS student_name, c.title AS course_title, c.id AS course_id,
              s.session_no, s.session_date::text
       FROM leave_requests lr
       JOIN enrollments e ON e.id=lr.enrollment_id
       JOIN students st ON st.id=e.student_id
       JOIN courses c ON c.id=e.course_id
       JOIN course_sessions s ON s.id=lr.session_id
       WHERE ($1='' OR lr.status=$1)
       ORDER BY CASE lr.status WHEN '待审批' THEN 0 ELSE 1 END, lr.created_at DESC LIMIT 300`,
      [status]
    );
    res.json(rows);
  })
);

leavesRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const enrollmentId = num(req.body.enrollment_id);
    const sessionId = num(req.body.session_id);
    const reasonType = str(req.body.reason_type);
    const reason = str(req.body.reason);
    if (!enrollmentId || !sessionId || !reasonType) return bad(res, '学员、课次、请假类型必填');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [enrollmentId]);
    const session = await one<any>(`SELECT * FROM course_sessions WHERE id=$1`, [sessionId]);
    if (!en || !session) return bad(res, '报名记录或课次不存在', 404);
    if (en.course_id !== session.course_id) return bad(res, '课次不属于该学员所报课程');
    const dup = await one(
      `SELECT id FROM leave_requests WHERE enrollment_id=$1 AND session_id=$2 AND status<>'已拒绝'`,
      [enrollmentId, sessionId]
    );
    if (dup) return bad(res, '该课次已有请假记录');
    const r = await one<any>(
      `INSERT INTO leave_requests(enrollment_id, session_id, reason_type, reason) VALUES($1,$2,$3,$4) RETURNING *`,
      [enrollmentId, sessionId, reasonType, reason]
    );
    await audit({
      entityType: 'leave',
      entityId: r.id,
      action: '创建请假',
      reason: `${reasonType}：${reason}`,
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json(r);
  })
);

// 批准请假 → 考勤记请假 + 自动生成补课单
leavesRouter.post(
  '/:id/approve',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const lr = await one<any>(`SELECT * FROM leave_requests WHERE id=$1`, [id]);
    if (!lr) return bad(res, '请假记录不存在', 404);
    if (lr.status !== '待审批') return bad(res, '该请假已处理');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [lr.enrollment_id]);
    await withTransaction(async (client) => {
      await client.query(`UPDATE leave_requests SET status='已批准', handled_by=$1, handled_at=now() WHERE id=$2`, [
        req.user!.name,
        id,
      ]);
      await client.query(
        `INSERT INTO attendances(session_id, enrollment_id, status, note)
         VALUES($1,$2,'请假',$3)
         ON CONFLICT (session_id, enrollment_id) DO UPDATE SET status='请假', note=EXCLUDED.note`,
        [lr.session_id, lr.enrollment_id, `${lr.reason_type}：${lr.reason}`]
      );
      await client.query(
        `INSERT INTO makeups(enrollment_id, leave_request_id, original_session_id, status) VALUES($1,$2,$3,'待安排')`,
        [lr.enrollment_id, id, lr.session_id]
      );
      await audit(
        {
          entityType: 'leave',
          entityId: id,
          action: '批准请假',
          reason: `${lr.reason_type}：${lr.reason}；已自动生成补课安排`,
          actor: req.user!.name,
          courseId: en.course_id,
          studentId: en.student_id,
        },
        client
      );
    });
    res.json({ ok: true });
  })
);

leavesRouter.post(
  '/:id/reject',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const note = str(req.body.note);
    const lr = await one<any>(`SELECT * FROM leave_requests WHERE id=$1`, [id]);
    if (!lr) return bad(res, '请假记录不存在', 404);
    if (lr.status !== '待审批') return bad(res, '该请假已处理');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [lr.enrollment_id]);
    await one(`UPDATE leave_requests SET status='已拒绝', handled_by=$1, handled_at=now() WHERE id=$2`, [
      req.user!.name,
      id,
    ]);
    await audit({
      entityType: 'leave',
      entityId: id,
      action: '拒绝请假',
      reason: note || '不符合请假条件',
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json({ ok: true });
  })
);

// ---------------- 补课 ----------------
makeupsRouter.get(
  '/',
  h(async (req, res) => {
    const status = str(req.query.status as string);
    const rows = await query(
      `SELECT mk.*, st.name AS student_name, c.title AS course_title, c.id AS course_id,
              os.session_no AS original_no, os.session_date::text AS original_date,
              ms.session_no AS makeup_no, ms.session_date::text AS makeup_date
       FROM makeups mk
       JOIN enrollments e ON e.id=mk.enrollment_id
       JOIN students st ON st.id=e.student_id
       JOIN courses c ON c.id=e.course_id
       JOIN course_sessions os ON os.id=mk.original_session_id
       LEFT JOIN course_sessions ms ON ms.id=mk.makeup_session_id
       WHERE ($1='' OR mk.status=$1)
       ORDER BY CASE mk.status WHEN '待安排' THEN 0 WHEN '已安排' THEN 1 ELSE 2 END, mk.created_at DESC LIMIT 300`,
      [status]
    );
    res.json(rows);
  })
);

// 安排补课：选择同课程的未来课次
makeupsRouter.post(
  '/:id/arrange',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const makeupSessionId = num(req.body.makeup_session_id);
    if (!makeupSessionId) return bad(res, '请选择补课课次');
    const mk = await one<any>(`SELECT * FROM makeups WHERE id=$1`, [id]);
    if (!mk) return bad(res, '补课记录不存在', 404);
    if (mk.status !== '待安排') return bad(res, '该补课已安排');
    const session = await one<any>(`SELECT * FROM course_sessions WHERE id=$1`, [makeupSessionId]);
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [mk.enrollment_id]);
    if (!session || session.course_id !== en.course_id) return bad(res, '补课课次须属于同一课程');
    await withTransaction(async (client) => {
      await client.query(`UPDATE makeups SET status='已安排', makeup_session_id=$1 WHERE id=$2`, [makeupSessionId, id]);
      // 在补课课次上预置一条补课考勤（未签到）
      await client.query(
        `INSERT INTO attendances(session_id, enrollment_id, status, is_makeup, makeup_for_session_id, note)
         VALUES($1,$2,'未签到',TRUE,$3,'补课安排')
         ON CONFLICT (session_id, enrollment_id) DO NOTHING`,
        [makeupSessionId, mk.enrollment_id, mk.original_session_id]
      );
      await audit(
        {
          entityType: 'makeup',
          entityId: id,
          action: '安排补课',
          reason: `安排至 ${session.session_date} 第${session.session_no}次课`,
          actor: req.user!.name,
          courseId: en.course_id,
          studentId: en.student_id,
        },
        client
      );
    });
    res.json({ ok: true });
  })
);

makeupsRouter.post(
  '/:id/void',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const reason = str(req.body.reason) || '不再安排补课';
    const mk = await one<any>(`SELECT * FROM makeups WHERE id=$1`, [id]);
    if (!mk) return bad(res, '补课记录不存在', 404);
    if (['已完成', '已失效'].includes(mk.status)) return bad(res, '该补课已结束');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [mk.enrollment_id]);
    await one(`UPDATE makeups SET status='已失效', note=$1 WHERE id=$2`, [reason, id]);
    await audit({
      entityType: 'makeup',
      entityId: id,
      action: '补课失效',
      reason,
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json({ ok: true });
  })
);

// ---------------- 退费 ----------------
refundsRouter.get(
  '/',
  h(async (req, res) => {
    const status = str(req.query.status as string);
    const rows = await query(
      `SELECT rf.*, st.name AS student_name, c.title AS course_title, c.id AS course_id, e.fee_amount, e.fee_status
       FROM refunds rf
       JOIN enrollments e ON e.id=rf.enrollment_id
       JOIN students st ON st.id=e.student_id
       JOIN courses c ON c.id=e.course_id
       WHERE ($1='' OR rf.status=$1)
       ORDER BY CASE rf.status WHEN '待审核' THEN 0 ELSE 1 END, rf.created_at DESC LIMIT 300`,
      [status]
    );
    res.json(rows);
  })
);

refundsRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const enrollmentId = num(req.body.enrollment_id);
    const amount = num(req.body.amount);
    const reasonType = str(req.body.reason_type);
    const reason = str(req.body.reason);
    if (!enrollmentId || !amount || amount <= 0 || !reasonType) return bad(res, '报名记录、金额、退费类型必填');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [enrollmentId]);
    if (!en) return bad(res, '报名记录不存在', 404);
    if (en.fee_status !== '已缴') return bad(res, '该报名未缴费，无需退费');
    const r = await one<any>(
      `INSERT INTO refunds(enrollment_id, amount, reason_type, reason) VALUES($1,$2,$3,$4) RETURNING *`,
      [enrollmentId, amount, reasonType, reason]
    );
    await audit({
      entityType: 'refund',
      entityId: r.id,
      action: '申请退费',
      reason: `${reasonType}：${reason}（${amount}元）`,
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json(r);
  })
);

refundsRouter.post(
  '/:id/approve',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const rf = await one<any>(`SELECT * FROM refunds WHERE id=$1`, [id]);
    if (!rf) return bad(res, '退费记录不存在', 404);
    if (rf.status !== '待审核') return bad(res, '该退费已处理');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [rf.enrollment_id]);
    await withTransaction(async (client) => {
      await client.query(`UPDATE refunds SET status='已退费', handled_by=$1, handled_at=now() WHERE id=$2`, [
        req.user!.name,
        id,
      ]);
      const newStatus = Number(rf.amount) >= Number(en.fee_amount) ? '已退' : '部分退';
      await client.query(`UPDATE enrollments SET fee_status=$1 WHERE id=$2`, [newStatus, en.id]);
      await audit(
        {
          entityType: 'refund',
          entityId: id,
          action: '退费审核通过',
          reason: `${rf.reason_type}：退费${rf.amount}元`,
          actor: req.user!.name,
          courseId: en.course_id,
          studentId: en.student_id,
        },
        client
      );
    });
    res.json({ ok: true });
  })
);

refundsRouter.post(
  '/:id/reject',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const note = str(req.body.note);
    const rf = await one<any>(`SELECT * FROM refunds WHERE id=$1`, [id]);
    if (!rf) return bad(res, '退费记录不存在', 404);
    if (rf.status !== '待审核') return bad(res, '该退费已处理');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [rf.enrollment_id]);
    await one(`UPDATE refunds SET status='已拒绝', handled_by=$1, handled_at=now() WHERE id=$2`, [
      req.user!.name,
      id,
    ]);
    await audit({
      entityType: 'refund',
      entityId: id,
      action: '退费审核拒绝',
      reason: note || '不符合退费条件',
      actor: req.user!.name,
      courseId: en.course_id,
      studentId: en.student_id,
    });
    res.json({ ok: true });
  })
);

// ---------------- 转班 ----------------
transfersRouter.get(
  '/',
  h(async (_req, res) => {
    const rows = await query(
      `SELECT t.*, st.name AS student_name, cf.title AS from_title, ct.title AS to_title
       FROM transfers t
       JOIN enrollments e ON e.id=t.enrollment_id
       JOIN students st ON st.id=e.student_id
       JOIN courses cf ON cf.id=t.from_course_id
       JOIN courses ct ON ct.id=t.to_course_id
       ORDER BY t.created_at DESC LIMIT 200`
    );
    res.json(rows);
  })
);

transfersRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const enrollmentId = num(req.body.enrollment_id);
    const toCourseId = num(req.body.to_course_id);
    const reason = str(req.body.reason);
    if (!enrollmentId || !toCourseId || !reason) return bad(res, '报名记录、目标课程、转班原因必填');
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [enrollmentId]);
    if (!en) return bad(res, '报名记录不存在', 404);
    if (!['已录取', '候补'].includes(en.status)) return bad(res, `当前状态为「${en.status}」，不能转班`);
    if (en.course_id === toCourseId) return bad(res, '目标课程与当前课程相同');
    const toCourse = await one<any>(`SELECT * FROM courses WHERE id=$1`, [toCourseId]);
    if (!toCourse) return bad(res, '目标课程不存在', 404);
    if (['已结课', '已取消'].includes(toCourse.status)) return bad(res, '目标课程已结束');
    const dup = await one(
      `SELECT id FROM enrollments WHERE student_id=$1 AND course_id=$2 AND status IN ('已录取','候补')`,
      [en.student_id, toCourseId]
    );
    if (dup) return bad(res, '该学员已报名目标课程');

    const result = await withTransaction(async (client) => {
      // 原报名 → 已转班
      await client.query(`UPDATE enrollments SET status='已转班', waitlist_position=NULL WHERE id=$1`, [enrollmentId]);
      // 目标课程名额判断
      const confirmed = (
        await client.query(
          `SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='已录取'`,
          [toCourseId]
        )
      ).rows[0].c;
      let status = '已录取';
      let position: number | null = null;
      if (confirmed >= toCourse.capacity) {
        status = '候补';
        position =
          (
            await client.query(
              `SELECT COALESCE(MAX(waitlist_position),0)::int AS p FROM enrollments WHERE course_id=$1 AND status='候补'`,
              [toCourseId]
            )
          ).rows[0].p + 1;
      }
      const student = (await client.query(`SELECT * FROM students WHERE id=$1`, [en.student_id])).rows[0];
      const newEn = await client.query(
        `INSERT INTO enrollments(student_id, course_id, age, level, health_limits, source, fee_amount, fee_status, status, waitlist_position)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          en.student_id,
          toCourseId,
          ageOf(student.birth_year),
          en.level,
          en.health_limits,
          en.source,
          toCourse.fee,
          en.fee_status === '已缴' ? '已缴' : '未缴',
          status,
          position,
        ]
      );
      const tr = await client.query(
        `INSERT INTO transfers(enrollment_id, new_enrollment_id, from_course_id, to_course_id, reason, created_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [enrollmentId, newEn.rows[0].id, en.course_id, toCourseId, reason, req.user!.name]
      );
      // 原课程空出名额 → 候补转正
      if (en.status === '已录取') {
        await promoteNext(en.course_id, req.user!.name, client);
      }
      await audit(
        {
          entityType: 'transfer',
          entityId: tr.rows[0].id,
          action: '临时换班',
          reason: `${reason}（转入${toCourse.title}，状态：${status}${position ? `第${position}位` : ''}）`,
          actor: req.user!.name,
          courseId: toCourseId,
          studentId: en.student_id,
        },
        client
      );
      return tr.rows[0];
    });
    res.json(result);
  })
);
