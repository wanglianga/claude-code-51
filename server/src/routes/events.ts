import { Router } from 'express';
import { query, one, withTransaction } from '../db';
import { h, bad, str, num } from '../helpers';
import { requireStaff } from '../auth';
import { audit } from '../audit';
import { roomConflict } from '../domain';

export const eventsRouter = Router();

// ---------------- 展演活动（作品展示/汇报演出） ----------------
eventsRouter.get(
  '/',
  h(async (req, res) => {
    const courseId = num(req.query.course_id);
    const rows = await query(
      `SELECT ev.*, c.title AS course_title, c.category, r.name AS room_name,
         (SELECT COUNT(*)::int FROM event_participants ep WHERE ep.event_id=ev.id) AS participant_count
       FROM events ev
       JOIN courses c ON c.id=ev.course_id
       LEFT JOIN rooms r ON r.id=ev.room_id
       WHERE ($1::int IS NULL OR ev.course_id=$1)
       ORDER BY ev.event_date DESC`,
      [courseId]
    );
    res.json(rows);
  })
);

eventsRouter.post(
  '/',
  requireStaff,
  h(async (req, res) => {
    const courseId = num(req.body.course_id);
    const title = str(req.body.title);
    const eventType = str(req.body.event_type);
    const eventDate = str(req.body.event_date);
    if (!courseId || !title || !eventType || !eventDate) return bad(res, '课程、活动名称、类型、日期必填');
    const roomId = num(req.body.room_id);
    if (roomId) {
      const clash = await roomConflict(roomId, eventDate, str(req.body.start_time, '09:00'), str(req.body.end_time, '11:00'));
      if (clash) return bad(res, `场地在该时段已被「${clash}」占用`);
    }
    const result = await withTransaction(async (client) => {
      const r = await client.query(
        `INSERT INTO events(course_id, title, event_type, event_date, room_id, rehearsal_count, costume_notes,
           family_observers, safety_plan)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          courseId,
          title,
          eventType,
          eventDate,
          roomId,
          num(req.body.rehearsal_count) ?? 0,
          str(req.body.costume_notes),
          num(req.body.family_observers) ?? 0,
          str(req.body.safety_plan),
        ]
      );
      if (roomId) {
        await client.query(
          `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
           VALUES($1,'展演',$2,$3,$4,$5,$6)`,
          [roomId, r.rows[0].id, title, eventDate, str(req.body.start_time, '09:00'), str(req.body.end_time, '11:00')]
        );
      }
      await audit(
        {
          entityType: 'event',
          entityId: r.rows[0].id,
          action: '创建展演活动',
          reason: `${eventType}：${title}`,
          actor: req.user!.name,
          courseId,
        },
        client
      );
      return r.rows[0];
    });
    res.json(result);
  })
);

eventsRouter.put(
  '/:id',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const r = await one<any>(
      `UPDATE events SET title=$1, event_type=$2, event_date=$3, room_id=$4, rehearsal_count=$5,
         costume_notes=$6, family_observers=$7, safety_plan=$8
       WHERE id=$9 RETURNING *`,
      [
        str(req.body.title),
        str(req.body.event_type),
        str(req.body.event_date),
        num(req.body.room_id),
        num(req.body.rehearsal_count) ?? 0,
        str(req.body.costume_notes),
        num(req.body.family_observers) ?? 0,
        str(req.body.safety_plan),
        id,
      ]
    );
    if (!r) return bad(res, '活动不存在', 404);
    res.json(r);
  })
);

// 参演名单
eventsRouter.get(
  '/:id/participants',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const rows = await query(
      `SELECT ep.*, st.name AS student_name, e.level
       FROM event_participants ep
       JOIN enrollments e ON e.id=ep.enrollment_id
       JOIN students st ON st.id=e.student_id
       WHERE ep.event_id=$1 ORDER BY ep.id`,
      [id]
    );
    res.json(rows);
  })
);

eventsRouter.post(
  '/:id/participants',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const ids: number[] = Array.isArray(req.body.enrollment_ids) ? req.body.enrollment_ids.map(Number) : [];
    if (!ids.length) return bad(res, '请选择参演学员');
    await withTransaction(async (client) => {
      for (const eid of ids) {
        await client.query(
          `INSERT INTO event_participants(event_id, enrollment_id, role) VALUES($1,$2,'参演') ON CONFLICT DO NOTHING`,
          [id, eid]
        );
      }
    });
    res.json({ ok: true });
  })
);

eventsRouter.delete(
  '/:id/participants/:pid',
  requireStaff,
  h(async (req, res) => {
    await query(`DELETE FROM event_participants WHERE id=$1 AND event_id=$2`, [
      num(req.params.pid),
      num(req.params.id),
    ]);
    res.json({ ok: true });
  })
);

// 状态流转：筹备中 → 已举办 → 已归档（归档小结进入课程档案）
eventsRouter.post(
  '/:id/status',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const status = str(req.body.status);
    const archiveNote = str(req.body.archive_note);
    if (!['已举办', '已归档'].includes(status)) return bad(res, '状态不正确');
    const ev = await one<any>(`SELECT * FROM events WHERE id=$1`, [id]);
    if (!ev) return bad(res, '活动不存在', 404);
    if (status === '已归档' && !archiveNote) return bad(res, '归档需填写小结（进入课程档案）');
    await one(`UPDATE events SET status=$1, archive_note=COALESCE(NULLIF($2,''), archive_note) WHERE id=$3`, [
      status,
      archiveNote,
      id,
    ]);
    await audit({
      entityType: 'event',
      entityId: id,
      action: status === '已举办' ? '活动举办' : '活动归档',
      reason: archiveNote || `${ev.title} ${status}`,
      actor: req.user!.name,
      courseId: ev.course_id,
    });
    res.json({ ok: true });
  })
);
