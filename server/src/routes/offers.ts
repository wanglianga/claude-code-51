import { Router } from 'express';
import { query, one, withTransaction } from '../db';
import { h, bad, str, num } from '../helpers';
import { requireStaff } from '../auth';
import { audit } from '../audit';
import {
  assignSeat,
  confirmedCount,
  expireStaleOffersGlobal,
  findTimeConflict,
  offerNextSeats,
  waitlistCandidates,
  HOT_WAITLIST_THRESHOLD,
} from '../domain';

export const offersRouter = Router();

// 候补候选人（含时间冲突/已顺延/待确认标注），供推送转正通知时查看
offersRouter.get(
  '/candidates/:courseId',
  h(async (req, res) => {
    const courseId = num(req.params.courseId)!;
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [courseId]);
    if (!course) return bad(res, '课程不存在', 404);
    const waitlistCount = (
      await one<any>(`SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='候补'`, [courseId])
    ).c;
    const candidates = await waitlistCandidates(courseId);
    res.json({
      course: { id: course.id, title: course.title, capacity: course.capacity },
      hot: waitlistCount >= HOT_WAITLIST_THRESHOLD,
      threshold: HOT_WAITLIST_THRESHOLD,
      waitlistCount,
      candidates: candidates.map((c) => ({
        enrollment_id: c.enrollment.id,
        student_name: c.enrollment.student_name,
        waitlist_position: c.enrollment.waitlist_position,
        level: c.enrollment.level,
        age: c.enrollment.age,
        fee_status: c.enrollment.fee_status,
        time_conflict: c.timeConflict,
        declined_before: c.declinedBefore,
        has_pending_offer: c.hasPendingOffer,
        eligible: c.eligible,
      })),
    });
  })
);

// 转正通知列表
offersRouter.get(
  '/',
  h(async (req, res) => {
    await expireStaleOffersGlobal();
    const status = str(req.query.status as string);
    const courseId = num(req.query.course_id);
    const rows = await query(
      `SELECT po.*, s.name AS student_name, c.title AS course_title
       FROM promotion_offers po
       JOIN students s ON s.id=po.student_id
       JOIN courses c ON c.id=po.course_id
       WHERE ($1='' OR po.status=$1) AND ($2::int IS NULL OR po.course_id=$2)
       ORDER BY CASE po.status WHEN '待确认' THEN 0 ELSE 1 END, po.offered_at DESC LIMIT 300`,
      [status, courseId]
    );
    res.json(rows);
  })
);

// 手动推送转正通知（热门课程只能按顺序推给第一位可推送者，不能手工插队）
offersRouter.post(
  '/course/:courseId',
  requireStaff,
  h(async (req, res) => {
    const courseId = num(req.params.courseId)!;
    const enrollmentId = num(req.body.enrollment_id);
    const note = str(req.body.note) || '工作人员手动推送转正通知';
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [courseId]);
    if (!course) return bad(res, '课程不存在', 404);
    const waitlistCount = (
      await one<any>(`SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='候补'`, [courseId])
    ).c;
    if (waitlistCount === 0) return bad(res, '该课程暂无候补学员');
    const hot = waitlistCount >= HOT_WAITLIST_THRESHOLD;

    if (enrollmentId) {
      // 指定推送：热门课程禁止手工插队
      if (hot) return bad(res, '热门课程候补须按顺序推送，不能手工插队', 403);
      const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [enrollmentId]);
      if (!en || en.course_id !== courseId || en.status !== '候补') return bad(res, '该报名不在候补队列中');
      const pending = await one(`SELECT id FROM promotion_offers WHERE enrollment_id=$1 AND status='待确认'`, [enrollmentId]);
      if (pending) return bad(res, '该学员已有待确认的转正通知');
      const conflict = await findTimeConflict(en.student_id, course);
      if (conflict) return bad(res, `该学员与「${conflict.title}」时间冲突，不可推送`);
      const r = await one<any>(
        `INSERT INTO promotion_offers(course_id, enrollment_id, student_id, queue_position, level, note, offered_by, expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7, now() + INTERVAL '48 hours') RETURNING *`,
        [courseId, en.id, en.student_id, en.waitlist_position, en.level, note, req.user!.name]
      );
      await audit({
        entityType: 'offer',
        entityId: r.id,
        action: '推送转正通知',
        reason: `${note}；候补第${en.waitlist_position}位`,
        actor: req.user!.name,
        courseId,
        studentId: en.student_id,
      });
      return res.json({ created: [r] });
    }

    // 自动按顺序推送（热门课程唯一方式）
    const created = await offerNextSeats(courseId, req.user!.name, note);
    if (!created.length) return bad(res, '暂无可推送的候补学员（可能存在时间冲突或已被顺延，详见候选人列表）');
    res.json({ created });
  })
);

// 候补学员确认转正：同步座位、缴费状态、教材检查、教师名单（审计留痕）
offersRouter.post(
  '/:id/confirm',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const offer = await one<any>(`SELECT * FROM promotion_offers WHERE id=$1`, [id]);
    if (!offer) return bad(res, '转正通知不存在', 404);
    if (offer.status !== '待确认') return bad(res, `该通知状态为「${offer.status}」，不能确认`);
    if (offer.expires_at && new Date(offer.expires_at) < new Date()) {
      await offerNextSeats(offer.course_id, req.user!.name, '前序通知过期自动顺延');
      return bad(res, '该通知已超过48小时确认期限，已自动顺延下一位', 410);
    }
    const en = await one<any>(`SELECT * FROM enrollments WHERE id=$1`, [offer.enrollment_id]);
    const course = await one<any>(`SELECT * FROM courses WHERE id=$1`, [offer.course_id]);

    const result = await withTransaction(async (client) => {
      const confirmed = (
        await client.query(`SELECT COUNT(*)::int AS c FROM enrollments WHERE course_id=$1 AND status='已录取'`, [
          offer.course_id,
        ])
      ).rows[0].c;
      if (confirmed >= course.capacity) throw new Error('名额已被占用，请先处理其他转正通知');
      const seat = await assignSeat(offer.course_id, client);
      await client.query(
        `UPDATE enrollments SET status='已录取', waitlist_position=NULL, seat_no=$1 WHERE id=$2`,
        [seat, en.id]
      );
      await client.query(`UPDATE promotion_offers SET status='已确认', responded_at=now() WHERE id=$1`, [id]);
      // 教材同步检查：新录取后每次课材料需求是否超出库存
      const materials = (
        await client.query(`SELECT * FROM materials WHERE course_id=$1`, [offer.course_id])
      ).rows;
      const warnings: string[] = [];
      for (const m of materials) {
        const need = Math.round(Number(m.per_student_qty) * (confirmed + 1) * 100) / 100;
        if (Number(m.stock_qty) < need) {
          warnings.push(`${m.name} 库存${m.stock_qty}${m.unit} < 每次课需求${need}${m.unit}`);
          await audit(
            {
              entityType: 'material',
              entityId: m.id,
              action: '材料不足预警',
              reason: `候补转正后每次课需${need}${m.unit}，库存仅${m.stock_qty}${m.unit}，请及时采购`,
              actor: '系统',
              courseId: offer.course_id,
            },
            client
          );
        }
      }
      await audit(
        {
          entityType: 'offer',
          entityId: id,
          action: '候补转正确认',
          reason: `${en.student_id}号学员确认转正：座位${seat}号，缴费状态${en.fee_status}（应缴${en.fee_amount}元），已同步教师名单${warnings.length ? '；' + warnings.join('；') : ''}`,
          actor: req.user!.name,
          courseId: offer.course_id,
          studentId: offer.student_id,
          meta: { seat_no: seat, fee_status: en.fee_status, material_warnings: warnings },
        },
        client
      );
      return { seat, warnings };
    });
    res.json({
      ok: true,
      seat_no: result.seat,
      fee_status: en.fee_status,
      fee_due: en.fee_status === '未缴' ? Number(en.fee_amount) : 0,
      material_warnings: result.warnings,
    });
  })
);

// 未确认 → 顺延下一位（保留原因）
offersRouter.post(
  '/:id/decline',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const reason = str(req.body.reason);
    if (!reason) return bad(res, '请填写未确认原因（将保留在档案中）');
    const offer = await one<any>(`SELECT * FROM promotion_offers WHERE id=$1`, [id]);
    if (!offer) return bad(res, '转正通知不存在', 404);
    if (offer.status !== '待确认') return bad(res, `该通知状态为「${offer.status}」`);
    await one(
      `UPDATE promotion_offers SET status='已顺延', reason=$1, responded_at=now() WHERE id=$2 RETURNING id`,
      [reason, id]
    );
    await audit({
      entityType: 'offer',
      entityId: id,
      action: '转正未确认顺延',
      reason,
      actor: req.user!.name,
      courseId: offer.course_id,
      studentId: offer.student_id,
    });
    // 自动顺延下一位
    const next = await offerNextSeats(offer.course_id, req.user!.name, '前序未确认自动顺延');
    res.json({ ok: true, next });
  })
);
