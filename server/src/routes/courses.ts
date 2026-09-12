import { Router } from 'express';
import { query, one, withTransaction } from '../db';
import { h, bad, str, num, weeklyDates } from '../helpers';
import { requireStaff } from '../auth';
import { audit } from '../audit';
import { generateSessions, generateLearningRecords, roomConflict } from '../domain';

export const coursesRouter = Router();

// ---------------- 课程列表 ----------------
coursesRouter.get(
  '/',
  h(async (req, res) => {
    const term = str(req.query.term as string);
    const status = str(req.query.status as string);
    const category = str(req.query.category as string);
    const rows = await query(
      `SELECT c.*, t.name AS teacher_name, r.name AS room_name, r.capacity AS room_capacity,
         (SELECT COUNT(*)::int FROM enrollments e WHERE e.course_id=c.id AND e.status='已录取') AS confirmed_count,
         (SELECT COUNT(*)::int FROM enrollments e WHERE e.course_id=c.id AND e.status='候补') AS waitlist_count
       FROM courses c
       LEFT JOIN teachers t ON t.id=c.teacher_id
       LEFT JOIN rooms r ON r.id=c.room_id
       WHERE ($1='' OR c.term=$1) AND ($2='' OR c.status=$2) AND ($3='' OR c.category=$3)
       ORDER BY c.created_at DESC, c.id DESC`,
      [term, status, category]
    );
    res.json(rows);
  })
);

coursesRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const title = str(req.body.title);
    const category = str(req.body.category);
    const term = str(req.body.term);
    const capacity = num(req.body.capacity);
    const startDate = str(req.body.start_date);
    if (!title || !category || !term || !capacity || !startDate) {
      return bad(res, '课程名称、类别、期次、容量、开课日期必填');
    }
    const weekday = new Date(startDate + 'T00:00:00').getDay() || 7;
    const r = await one<any>(
      `INSERT INTO courses(title, category, term, teacher_id, room_id, weekday, start_time, end_time,
         start_date, total_sessions, capacity, fee, material_note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        title,
        category,
        term,
        num(req.body.teacher_id),
        num(req.body.room_id),
        weekday,
        str(req.body.start_time, '09:00'),
        str(req.body.end_time, '10:30'),
        startDate,
        num(req.body.total_sessions) ?? 10,
        capacity,
        num(req.body.fee) ?? 0,
        str(req.body.material_note),
      ]
    );
    await audit({ entityType: 'course', entityId: r.id, action: '新建课程', actor: req.user!.name, courseId: r.id });
    res.json(r);
  })
);

coursesRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const course = await one(
      `SELECT c.*, t.name AS teacher_name, r.name AS room_name, r.capacity AS room_capacity, r.equipment
       FROM courses c LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN rooms r ON r.id=c.room_id
       WHERE c.id=$1`,
      [id]
    );
    if (!course) return bad(res, '课程不存在', 404);
    const [materials, events, counts] = await Promise.all([
      query(`SELECT * FROM materials WHERE course_id=$1 ORDER BY id`, [id]),
      query(`SELECT * FROM events WHERE course_id=$1 ORDER BY event_date`, [id]),
      one(
        `SELECT
           COUNT(*) FILTER (WHERE status='已录取')::int AS confirmed,
           COUNT(*) FILTER (WHERE status='候补')::int AS waitlist
         FROM enrollments WHERE course_id=$1`,
        [id]
      ),
    ]);
    res.json({ ...course, materials, events, counts });
  })
);

coursesRouter.put(
  '/:id',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const startDate = str(req.body.start_date);
    const weekday = startDate ? new Date(startDate + 'T00:00:00').getDay() || 7 : null;
    const r = await one<any>(
      `UPDATE courses SET title=$1, category=$2, term=$3, teacher_id=$4, room_id=$5,
         weekday=COALESCE($6, weekday), start_time=$7, end_time=$8,
         start_date=COALESCE($9, start_date), total_sessions=$10, capacity=$11, fee=$12, material_note=$13
       WHERE id=$14 RETURNING *`,
      [
        str(req.body.title),
        str(req.body.category),
        str(req.body.term),
        num(req.body.teacher_id),
        num(req.body.room_id),
        weekday,
        str(req.body.start_time),
        str(req.body.end_time),
        startDate || null,
        num(req.body.total_sessions),
        num(req.body.capacity),
        num(req.body.fee),
        str(req.body.material_note),
        id,
      ]
    );
    if (!r) return bad(res, '课程不存在', 404);
    res.json(r);
  })
);

// ---------------- 开班前检查 ----------------
coursesRouter.get(
  '/:id/precheck',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [id]);
    if (!course) return bad(res, '课程不存在', 404);
    const room = await one<any>(`SELECT * FROM rooms WHERE id=$1`, [course.room_id]);
    const teacher = await one<any>(`SELECT * FROM teachers WHERE id=$1`, [course.teacher_id]);
    const counts = await one<any>(
      `SELECT COUNT(*) FILTER (WHERE status='已录取')::int AS confirmed,
              COUNT(*) FILTER (WHERE status='候补')::int AS waitlist
       FROM enrollments WHERE course_id=$1`,
      [id]
    );

    // 教师排班冲突：同一教师其他未结课课程同星期且时段重叠
    const teacherConflicts = await query(
      `SELECT title, start_time, end_time FROM courses
       WHERE teacher_id=$1 AND id<>$2 AND weekday=$3 AND status IN ('报名中','已开班')
         AND NOT (end_time<=$4 OR start_time>=$5)`,
      [course.teacher_id, id, course.weekday, course.start_time, course.end_time]
    );
    const weeklyLoad = (
      await one<any>(
        `SELECT COUNT(*)::int AS c FROM courses WHERE teacher_id=$1 AND status IN ('报名中','已开班')`,
        [course.teacher_id]
      )
    ).c;

    // 材料检查：库存是否够已录取学员一次课
    const materials = await query(
      `SELECT *, (per_student_qty * $2)::numeric(10,2) AS need_per_session,
         (stock_qty >= per_student_qty * $2) AS ok
       FROM materials WHERE course_id=$1`,
      [id, counts.confirmed]
    );

    // 教室占用冲突：未来课次是否与其他占用冲突
    const dates = weeklyDates(course.start_date, course.total_sessions);
    const bookingConflicts: string[] = [];
    for (const d of dates) {
      const clash = await roomConflict(course.room_id, d, course.start_time, course.end_time);
      if (clash) bookingConflicts.push(`${d} ${course.start_time} 与「${clash}」冲突`);
    }

    res.json({
      room: {
        name: room?.name,
        capacity: room?.capacity,
        ok: room ? room.capacity >= course.capacity : false,
      },
      capacity: { course: course.capacity, confirmed: counts.confirmed, ok: counts.confirmed <= course.capacity },
      waitlist: counts.waitlist,
      teacher: {
        name: teacher?.name,
        weeklyLoad,
        maxWeekly: teacher?.max_weekly_sessions,
        loadOk: teacher ? weeklyLoad <= teacher.max_weekly_sessions : true,
        conflicts: teacherConflicts,
      },
      materials,
      bookingConflicts,
    });
  })
);

// ---------------- 确认开班 ----------------
coursesRouter.post(
  '/:id/confirm',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const overrideReason = str(req.body.override_reason);
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [id]);
    if (!course) return bad(res, '课程不存在', 404);
    if (course.status !== '报名中') return bad(res, `当前状态为「${course.status}」，不能重复开班`);

    // 汇总问题
    const problems: string[] = [];
    const room = await one<any>(`SELECT * FROM rooms WHERE id=$1`, [course.room_id]);
    if (room && room.capacity < course.capacity) problems.push(`教室容量${room.capacity}小于课程容量${course.capacity}`);
    const teacherConflicts = await query(
      `SELECT title FROM courses WHERE teacher_id=$1 AND id<>$2 AND weekday=$3
         AND status IN ('报名中','已开班') AND NOT (end_time<=$4 OR start_time>=$5)`,
      [course.teacher_id, id, course.weekday, course.start_time, course.end_time]
    );
    if (teacherConflicts.length) problems.push(`教师排班冲突：${teacherConflicts.map((t: any) => t.title).join('、')}`);
    const dates = weeklyDates(course.start_date, course.total_sessions);
    for (const d of dates) {
      const clash = await roomConflict(course.room_id, d, course.start_time, course.end_time);
      if (clash) problems.push(`${d} 教室已被「${clash}」占用`);
    }
    if (problems.length && !overrideReason) {
      return res.status(409).json({ error: '开班检查未通过，如需强制开班请填写原因', problems });
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE courses SET status='已开班', confirm_note=$1 WHERE id=$2`,
        [problems.length ? `强制开班：${overrideReason}` : '检查通过，正常开班', id]
      );
      await generateSessions({ ...course }, client);
      await audit(
        {
          entityType: 'course',
          entityId: id,
          action: '确认开班',
          reason: problems.length ? `强制开班：${overrideReason}（存在问题：${problems.join('；')}）` : '教室容量/教师排班/材料/教室占用检查通过',
          actor: req.user!.name,
          courseId: id,
        },
        client
      );
    });
    res.json({ ok: true, problems });
  })
);

// ---------------- 结课 ----------------
coursesRouter.post(
  '/:id/complete',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [id]);
    if (!course) return bad(res, '课程不存在', 404);
    if (course.status !== '已开班') return bad(res, '仅已开班课程可结课');
    await withTransaction(async (client) => {
      await generateLearningRecords(id, req.user!.name, client);
      await client.query(`UPDATE courses SET status='已结课' WHERE id=$1`, [id]);
      await audit(
        { entityType: 'course', entityId: id, action: '课程结课', reason: '课程结束，已生成学员学习记录', actor: req.user!.name, courseId: id },
        client
      );
    });
    res.json({ ok: true });
  })
);

// ---------------- 取消课程 ----------------
coursesRouter.post(
  '/:id/cancel',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const reason = str(req.body.reason);
    if (!reason) return bad(res, '请填写取消原因');
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [id]);
    if (!course) return bad(res, '课程不存在', 404);
    if (['已结课', '已取消'].includes(course.status)) return bad(res, `课程已${course.status === '已结课' ? '结课' : '取消'}`);

    await withTransaction(async (client) => {
      await client.query(`UPDATE courses SET status='已取消' WHERE id=$1`, [id]);
      // 已缴费学员自动生成全额退费申请
      const paid = (
        await client.query(
          `SELECT * FROM enrollments WHERE course_id=$1 AND status='已录取' AND fee_status='已缴'`,
          [id]
        )
      ).rows;
      for (const en of paid) {
        await client.query(
          `INSERT INTO refunds(enrollment_id, amount, reason_type, reason, status)
           VALUES($1,$2,'课程取消',$3,'待审核')`,
          [en.id, en.fee_amount, `课程取消：${reason}`]
        );
      }
      await client.query(`UPDATE course_sessions SET status='已停课', cancel_reason=$1 WHERE course_id=$2 AND status='正常'`, [
        `课程取消：${reason}`,
        id,
      ]);
      await audit(
        {
          entityType: 'course',
          entityId: id,
          action: '取消课程',
          reason: `${reason}；已为 ${paid.length} 名已缴费学员生成全额退费申请`,
          actor: req.user!.name,
          courseId: id,
        },
        client
      );
    });
    res.json({ ok: true });
  })
);

// ---------------- 课程报名名单 ----------------
coursesRouter.get(
  '/:id/enrollments',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const rows = await query(
      `SELECT e.*, s.name AS student_name, s.gender, s.phone, s.birth_year,
              ev.rating AS eval_rating, ev.comment AS eval_comment
       FROM enrollments e
       JOIN students s ON s.id=e.student_id
       LEFT JOIN evaluations ev ON ev.enrollment_id=e.id AND ev.course_id=e.course_id
       WHERE e.course_id=$1
       ORDER BY CASE e.status WHEN '已录取' THEN 0 WHEN '候补' THEN 1 ELSE 2 END,
                e.waitlist_position NULLS LAST, e.id`,
      [id]
    );
    res.json(rows);
  })
);

// ---------------- 课次 ----------------
coursesRouter.get(
  '/:id/sessions',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const rows = await query(
      `SELECT s.*, r.name AS room_name, t.name AS teacher_name,
         (SELECT COUNT(*)::int FROM attendances a WHERE a.session_id=s.id AND a.status IN ('签到','迟到')) AS present_count,
         (SELECT COUNT(*)::int FROM attendances a WHERE a.session_id=s.id AND a.status='请假') AS leave_count
       FROM course_sessions s
       LEFT JOIN rooms r ON r.id=s.room_id
       LEFT JOIN teachers t ON t.id=s.teacher_id
       WHERE s.course_id=$1 ORDER BY s.session_date, s.id`,
      [id]
    );
    res.json(rows);
  })
);
