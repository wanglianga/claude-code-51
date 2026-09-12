import { Router } from 'express';
import { query, one, withTransaction } from '../db';
import { h, bad, str, num, fmtDate } from '../helpers';
import { requireStaff } from '../auth';
import { audit } from '../audit';
import { roomConflict } from '../domain';

export const sessionsRouter = Router();

// 课次详情（含考勤名单）
sessionsRouter.get(
  '/:id',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const session = await one(
      `SELECT s.*, c.title AS course_title, c.id AS course_id, r.name AS room_name, t.name AS teacher_name
       FROM course_sessions s
       JOIN courses c ON c.id=s.course_id
       LEFT JOIN rooms r ON r.id=s.room_id
       LEFT JOIN teachers t ON t.id=s.teacher_id
       WHERE s.id=$1`,
      [id]
    );
    if (!session) return bad(res, '课次不存在', 404);
    const attendances = await query(
      `SELECT e.id AS enrollment_id, e.student_id, st.name AS student_name, e.status AS enrollment_status,
              a.id AS attendance_id, a.status, a.is_makeup, a.makeup_for_session_id, a.check_in_time, a.note
       FROM enrollments e
       JOIN students st ON st.id=e.student_id
       LEFT JOIN attendances a ON a.enrollment_id=e.id AND a.session_id=$1
       WHERE e.course_id=$2 AND e.status='已录取'
       ORDER BY st.name`,
      [id, session.course_id]
    );
    // 本课次相关的请假
    const leaves = await query(
      `SELECT lr.*, st.name AS student_name FROM leave_requests lr
       JOIN enrollments e ON e.id=lr.enrollment_id JOIN students st ON st.id=e.student_id
       WHERE lr.session_id=$1`,
      [id]
    );
    res.json({ ...session, attendances, leaves });
  })
);

// 批量保存考勤（签到/迟到/请假/缺席/代签异常 + 课堂备注）
sessionsRouter.put(
  '/:id/attendance',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const session = await one<any>(`SELECT * FROM course_sessions WHERE id=$1`, [id]);
    if (!session) return bad(res, '课次不存在', 404);
    if (session.status === '已停课') return bad(res, '该课次已停课，不能考勤');
    const records: any[] = Array.isArray(req.body.records) ? req.body.records : [];
    const valid = ['签到', '迟到', '请假', '缺席', '代签异常', '未签到'];
    const sessionNote = str(req.body.session_note);
    // 先校验：代签异常必须填写备注说明
    for (const r of records) {
      if (str(r.status) === '代签异常' && !str(r.note)) {
        return bad(res, '代签异常必须填写备注说明');
      }
    }

    await withTransaction(async (client) => {
      if (sessionNote) {
        await client.query(`UPDATE course_sessions SET note=$1 WHERE id=$2`, [sessionNote, id]);
      }
      for (const r of records) {
        const status = str(r.status);
        if (!valid.includes(status)) continue;
        const note = str(r.note);
        const eid = num(r.enrollment_id);
        if (!eid) continue;
        await client.query(
          `INSERT INTO attendances(session_id, enrollment_id, status, note, check_in_time)
           VALUES($1,$2,$3,$4, CASE WHEN $3 IN ('签到','迟到') THEN now() ELSE NULL END)
           ON CONFLICT (session_id, enrollment_id)
           DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note,
             check_in_time=CASE WHEN EXCLUDED.status IN ('签到','迟到') THEN now() ELSE NULL END`,
          [id, eid, status, note]
        );
        if (status === '代签异常') {
          const en = (await client.query(`SELECT * FROM enrollments WHERE id=$1`, [eid])).rows[0];
          await audit(
            {
              entityType: 'session',
              entityId: id,
              action: '代签异常',
              reason: note,
              actor: req.user!.name,
              courseId: session.course_id,
              studentId: en?.student_id,
            },
            client
          );
        }
        // 补课课次签到 → 对应补课单自动完成
        await client.query(
          `UPDATE makeups SET status='已完成', note=COALESCE(NULLIF(note,''),'补课课次已签到')
           WHERE enrollment_id=$1 AND makeup_session_id=$2 AND status='已安排'
             AND EXISTS (SELECT 1 FROM attendances a WHERE a.session_id=$2 AND a.enrollment_id=$1 AND a.status IN ('签到','迟到'))`,
          [eid, id]
        );
      }
    });
    res.json({ ok: true });
  })
);

// 停课处理：教师停课/教室冲突/材料不足 → 补课 / 退费 / 换教室
sessionsRouter.post(
  '/:id/cancel',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const reasonType = str(req.body.reason_type); // 教师停课/教室冲突/材料不足
    const reason = str(req.body.reason);
    const action = str(req.body.action); // 补课/退费/换教室
    const newRoomId = num(req.body.new_room_id);
    if (!['教师停课', '教室冲突', '材料不足'].includes(reasonType)) return bad(res, '停课类型不正确');
    if (!reason) return bad(res, '请填写停课原因说明');
    if (!['补课', '退费', '换教室'].includes(action)) return bad(res, '处理方式不正确');

    const session = await one<any>(`SELECT * FROM course_sessions WHERE id=$1`, [id]);
    if (!session) return bad(res, '课次不存在', 404);
    if (session.status === '已停课') return bad(res, '该课次已停课');
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [session.course_id]);

    if (action === '换教室') {
      if (!newRoomId) return bad(res, '请选择新教室');
      const clash = await roomConflict(newRoomId, session.session_date, session.start_time, session.end_time);
      if (clash) return bad(res, `新教室在该时段已被「${clash}」占用`);
      await withTransaction(async (client) => {
        await client.query(`UPDATE course_sessions SET room_id=$1, note=$2 WHERE id=$3`, [
          newRoomId,
          `${reasonType}换教室：${reason}`,
          id,
        ]);
        await client.query(
          `UPDATE room_bookings SET room_id=$1 WHERE booking_type='课程' AND ref_id=$2`,
          [newRoomId, id]
        );
        await audit(
          {
            entityType: 'session',
            entityId: id,
            action: `${reasonType}换教室`,
            reason,
            actor: req.user!.name,
            courseId: session.course_id,
          },
          client
        );
      });
      return res.json({ ok: true });
    }

    await withTransaction(async (client) => {
      // 标记停课 + 全员考勤记为停课
      await client.query(`UPDATE course_sessions SET status='已停课', cancel_reason=$1 WHERE id=$2`, [
        `${reasonType}：${reason}`,
        id,
      ]);
      const enrolled = (
        await client.query(
          `SELECT * FROM enrollments WHERE course_id=$1 AND status='已录取'`,
          [session.course_id]
        )
      ).rows;
      for (const en of enrolled) {
        await client.query(
          `INSERT INTO attendances(session_id, enrollment_id, status, note)
           VALUES($1,$2,'停课',$3)
           ON CONFLICT (session_id, enrollment_id) DO UPDATE SET status='停课', note=EXCLUDED.note`,
          [id, en.id, `${reasonType}停课`]
        );
      }

      if (action === '补课') {
        // 在最后一次课后追加补课课次
        const last = (
          await client.query(
            `SELECT MAX(session_date)::text AS d FROM course_sessions WHERE course_id=$1`,
            [session.course_id]
          )
        ).rows[0];
        const makeupDate = fmtDate(new Date(new Date(last.d).getTime() + 7 * 86400000));
        const clash = await roomConflict(session.room_id, makeupDate, session.start_time, session.end_time, client);
        if (clash) throw new Error(`补课日期 ${makeupDate} 教室已被「${clash}」占用，请改选退费或换教室`);
        const maxNo = (
          await client.query(`SELECT COALESCE(MAX(session_no),0)::int AS n FROM course_sessions WHERE course_id=$1`, [
            session.course_id,
          ])
        ).rows[0].n;
        const mk = await client.query(
          `INSERT INTO course_sessions(course_id, session_no, session_date, start_time, end_time, room_id, teacher_id, is_makeup_session, note)
           VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8) RETURNING id`,
          [
            session.course_id,
            maxNo + 1,
            makeupDate,
            session.start_time,
            session.end_time,
            session.room_id,
            session.teacher_id,
            `补课：原第${session.session_no}次课（${reasonType}）`,
          ]
        );
        await client.query(
          `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
           VALUES($1,'课程',$2,$3,$4,$5,$6)`,
          [session.room_id, mk.rows[0].id, `${course.title} 补课（原第${session.session_no}次课）`, makeupDate, session.start_time, session.end_time]
        );
      } else if (action === '退费') {
        // 按单次课费用为已缴费学员生成退费申请
        const perFee = Math.round((Number(course.fee) / course.total_sessions) * 100) / 100;
        for (const en of enrolled) {
          if (en.fee_status !== '已缴') continue;
          await client.query(
            `INSERT INTO refunds(enrollment_id, amount, reason_type, reason, status)
             VALUES($1,$2,$3,$4,'待审核')`,
            [en.id, perFee, reasonType, `第${session.session_no}次课${reasonType}停课：${reason}`]
          );
        }
      }
      await audit(
        {
          entityType: 'session',
          entityId: id,
          action: `${reasonType}停课（${action}处理）`,
          reason,
          actor: req.user!.name,
          courseId: session.course_id,
        },
        client
      );
    });
    res.json({ ok: true });
  })
);

// 登记材料消耗（按实际到课人数扣减库存）
sessionsRouter.post(
  '/:id/consume-materials',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const session = await one<any>(`SELECT * FROM course_sessions WHERE id=$1`, [id]);
    if (!session) return bad(res, '课次不存在', 404);
    const present = (
      await one<any>(
        `SELECT COUNT(*)::int AS c FROM attendances WHERE session_id=$1 AND status IN ('签到','迟到')`,
        [id]
      )
    ).c;
    if (present === 0) return bad(res, '该课次尚无到课记录，请先完成考勤');
    const materials = await query<any>(`SELECT * FROM materials WHERE course_id=$1`, [session.course_id]);
    if (!materials.length) return bad(res, '该课程未配置材料');

    const shortages: string[] = [];
    await withTransaction(async (client) => {
      for (const m of materials) {
        const need = Math.round(Number(m.per_student_qty) * present * 100) / 100;
        if (Number(m.stock_qty) < need) {
          shortages.push(`${m.name} 库存${m.stock_qty}${m.unit}，需${need}${m.unit}`);
          await audit(
            {
              entityType: 'material',
              entityId: m.id,
              action: '材料不足',
              reason: `第${session.session_no}次课需${need}${m.unit}，库存仅${m.stock_qty}${m.unit}`,
              actor: req.user!.name,
              courseId: session.course_id,
            },
            client
          );
          continue;
        }
        await client.query(`UPDATE materials SET stock_qty=stock_qty-$1 WHERE id=$2`, [need, m.id]);
        await client.query(
          `INSERT INTO material_logs(material_id, session_id, change_qty, reason, created_by)
           VALUES($1,$2,$3,$4,$5)`,
          [m.id, id, -need, `第${session.session_no}次课消耗（${present}人到课）`, req.user!.name]
        );
        await audit(
          {
            entityType: 'material',
            entityId: m.id,
            action: '材料消耗',
            reason: `第${session.session_no}次课消耗${m.name}${need}${m.unit}（${present}人到课）`,
            actor: req.user!.name,
            courseId: session.course_id,
          },
          client
        );
      }
    });
    res.json({ ok: true, shortages });
  })
);

// ---------------- 材料 ----------------
export const materialsRouter = Router();

materialsRouter.get(
  '/',
  h(async (req, res) => {
    const courseId = num(req.query.course_id);
    const rows = await query(
      `SELECT m.*, c.title AS course_title,
         (SELECT COUNT(*)::int FROM enrollments e WHERE e.course_id=m.course_id AND e.status='已录取') AS confirmed_count,
         (m.per_student_qty * (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=m.course_id AND e.status='已录取'))::numeric(10,2) AS need_per_session
       FROM materials m JOIN courses c ON c.id=m.course_id
       WHERE ($1::int IS NULL OR m.course_id=$1)
       ORDER BY m.course_id, m.id`,
      [courseId]
    );
    res.json(rows);
  })
);

materialsRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const courseId = num(req.body.course_id);
    const name = str(req.body.name);
    if (!courseId || !name) return bad(res, '课程与材料名称必填');
    const r = await one<any>(
      `INSERT INTO materials(course_id, name, unit, per_student_qty, stock_qty) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [courseId, name, str(req.body.unit, '份'), num(req.body.per_student_qty) ?? 1, num(req.body.stock_qty) ?? 0]
    );
    res.json(r);
  })
);

// 入库
materialsRouter.post(
  '/:id/restock',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const qty = num(req.body.qty);
    const reason = str(req.body.reason) || '采购入库';
    if (!qty || qty <= 0) return bad(res, '入库数量必须大于0');
    const m = await one<any>(`UPDATE materials SET stock_qty=stock_qty+$1 WHERE id=$2 RETURNING *`, [qty, id]);
    if (!m) return bad(res, '材料不存在', 404);
    await query(`INSERT INTO material_logs(material_id, change_qty, reason, created_by) VALUES($1,$2,$3,$4)`, [
      id,
      qty,
      reason,
      req.user!.name,
    ]);
    await audit({
      entityType: 'material',
      entityId: id,
      action: '材料入库',
      reason: `${reason}：+${qty}${m.unit}`,
      actor: req.user!.name,
      courseId: m.course_id,
    });
    res.json(m);
  })
);

materialsRouter.get(
  '/:id/logs',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    res.json(
      await query(
        `SELECT ml.*, s.session_no, s.session_date::text FROM material_logs ml
         LEFT JOIN course_sessions s ON s.id=ml.session_id
         WHERE ml.material_id=$1 ORDER BY ml.created_at DESC LIMIT 50`,
        [id]
      )
    );
  })
);
