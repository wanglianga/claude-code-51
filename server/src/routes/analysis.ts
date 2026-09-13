import { Router } from 'express';
import { query, one } from '../db';
import { h, bad, str, num } from '../helpers';
import { requireStaff } from '../auth';
import { audit } from '../audit';
import { expireStaleOffersGlobal } from '../domain';

export const analysisRouter = Router();

// ---------------- 仪表盘总览 ----------------
analysisRouter.get(
  '/overview',
  h(async (_req, res) => {
    await expireStaleOffersGlobal();
    const [
      students,
      activeCourses,
      pendingLeaves,
      pendingRefunds,
      pendingMakeups,
      waitlistTotal,
      pendingOffers,
      materialWarnings,
      recentAudits,
    ] = await Promise.all([
      one(`SELECT COUNT(*)::int AS c FROM students`),
      one(`SELECT COUNT(*)::int AS c FROM courses WHERE status IN ('报名中','已开班')`),
      one(`SELECT COUNT(*)::int AS c FROM leave_requests WHERE status='待审批'`),
      one(`SELECT COUNT(*)::int AS c FROM refunds WHERE status='待审核'`),
      one(`SELECT COUNT(*)::int AS c FROM makeups WHERE status='待安排'`),
      one(`SELECT COUNT(*)::int AS c FROM enrollments WHERE status='候补'`),
      one(`SELECT COUNT(*)::int AS c FROM promotion_offers WHERE status='待确认'`),
      query(
        `SELECT m.*, c.title AS course_title,
           (m.per_student_qty * (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=m.course_id AND e.status='已录取'))::numeric(10,2) AS need
         FROM materials m JOIN courses c ON c.id=m.course_id
         WHERE c.status IN ('报名中','已开班')
           AND m.stock_qty < m.per_student_qty * (SELECT COUNT(*) FROM enrollments e WHERE e.course_id=m.course_id AND e.status='已录取')`
      ),
      query(`SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 8`),
    ]);
    res.json({
      students: students.c,
      activeCourses: activeCourses.c,
      pendingLeaves: pendingLeaves.c,
      pendingRefunds: pendingRefunds.c,
      pendingMakeups: pendingMakeups.c,
      waitlistTotal: waitlistTotal.c,
      pendingOffers: pendingOffers.c,
      materialWarnings,
      recentAudits,
    });
  })
);

// ---------------- 活动室资源分析：热门课程是否挤占其他社区服务 ----------------
analysisRouter.get(
  '/rooms',
  h(async (_req, res) => {
    const rooms = await query<any>(`SELECT * FROM rooms ORDER BY id`);
    const result = [];
    for (const room of rooms) {
      const rows = await query<any>(
        `SELECT booking_type,
           COALESCE(SUM(
             (EXTRACT(EPOCH FROM (end_time::time - start_time::time)))/3600
           ),0)::numeric(10,2) AS hours,
           COUNT(*)::int AS cnt
         FROM room_bookings
         WHERE room_id=$1 AND booking_date >= CURRENT_DATE - INTERVAL '28 days'
           AND booking_date <= CURRENT_DATE + INTERVAL '28 days'
         GROUP BY booking_type`,
        [room.id]
      );
      const byType: Record<string, { hours: number; cnt: number }> = {};
      for (const r of rows) byType[r.booking_type] = { hours: Number(r.hours), cnt: r.cnt };
      const courseHours = (byType['课程']?.hours ?? 0) + (byType['排练']?.hours ?? 0) + (byType['展演']?.hours ?? 0);
      const communityHours = byType['社区服务']?.hours ?? 0;
      const total = courseHours + communityHours;
      const ratio = total > 0 ? Math.round((courseHours / total) * 100) : 0;
      let verdict = '正常';
      if (room.shared_with_community && total > 0) {
        if (ratio >= 70) verdict = '课程明显挤占社区服务时段，建议协调错峰';
        else if (ratio >= 50) verdict = '课程占用偏高，需关注社区服务时段保障';
      }
      result.push({
        ...room,
        course_hours: courseHours,
        community_hours: communityHours,
        course_ratio: ratio,
        course_bookings: (byType['课程']?.cnt ?? 0) + (byType['排练']?.cnt ?? 0) + (byType['展演']?.cnt ?? 0),
        community_bookings: byType['社区服务']?.cnt ?? 0,
        verdict,
      });
    }
    res.json(result);
  })
);

// ---------------- 候补需求分析：候补是否反映真实需求 ----------------
analysisRouter.get(
  '/waitlist',
  h(async (_req, res) => {
    const rows = await query<any>(
      `SELECT c.id, c.title, c.category, c.term, c.capacity, c.status,
         COUNT(*) FILTER (WHERE e.status='已录取')::int AS confirmed,
         COUNT(*) FILTER (WHERE e.status='候补')::int AS waitlist,
         COUNT(*) FILTER (WHERE e.status='候补' AND e.fee_status='已缴')::int AS waitlist_paid
       FROM courses c
       LEFT JOIN enrollments e ON e.course_id=c.id
       WHERE c.status IN ('报名中','已开班')
       GROUP BY c.id ORDER BY waitlist DESC, c.id`
    );
    res.json(
      rows.map((r) => {
        const pressure = r.capacity > 0 ? Math.round((r.waitlist / r.capacity) * 100) / 100 : 0;
        const paidRatio = r.waitlist > 0 ? Math.round((r.waitlist_paid / r.waitlist) * 100) : 0;
        let verdict = '无候补';
        if (r.waitlist > 0) {
          verdict =
            paidRatio >= 60
              ? '候补缴费率高，反映真实需求，建议扩班'
              : '候补缴费率偏低，需求待核实，建议电话确认';
        }
        return { ...r, pressure, paid_ratio: paidRatio, verdict };
      })
    );
  })
);

// ---------------- 下期规划建议（候补压力 → 扩班） ----------------
analysisRouter.get(
  '/next-term',
  h(async (_req, res) => {
    // 班级规模与候补分开统计，避免 JOIN 重复计数
    const courses = await query<any>(
      `SELECT category, COUNT(*)::int AS classes, SUM(capacity)::int AS capacity
       FROM courses WHERE status IN ('报名中','已开班') GROUP BY category`
    );
    const waitlists = await query<any>(
      `SELECT c.category,
         COUNT(*) FILTER (WHERE e.status='候补')::int AS waitlist,
         COUNT(*) FILTER (WHERE e.status='候补' AND e.fee_status='已缴')::int AS waitlist_paid
       FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id
       WHERE c.status IN ('报名中','已开班') GROUP BY c.category`
    );
    const wlMap: Record<string, any> = {};
    for (const w of waitlists) wlMap[w.category] = w;
    res.json(
      courses.map((r) => {
        const waitlist = wlMap[r.category]?.waitlist ?? 0;
        const waitlistPaid = wlMap[r.category]?.waitlist_paid ?? 0;
        const pressure = r.capacity > 0 ? Math.round((waitlist / r.capacity) * 100) / 100 : 0;
        const avgCap = r.classes > 0 ? Math.round(r.capacity / r.classes) : 20;
        const extra = waitlist > 0 ? Math.ceil(waitlist / avgCap) : 0;
        return {
          category: r.category,
          classes: r.classes,
          capacity: r.capacity,
          waitlist,
          waitlist_paid: waitlistPaid,
          pressure,
          suggested_classes: r.classes + (pressure >= 0.2 ? extra : 0),
          suggestion:
            pressure >= 0.2
              ? `候补${waitlist}人（${waitlistPaid}人已缴费），建议下期扩${extra}个班`
              : '候补压力小，维持现有规模',
        };
      })
    );
  })
);

// ---------------- 下期规划（保存社区决策） ----------------
analysisRouter.get(
  '/term-plans',
  h(async (_req, res) => {
    res.json(await query(`SELECT * FROM term_plans ORDER BY created_at DESC, id DESC LIMIT 50`));
  })
);

analysisRouter.post(
  '/term-plans',
  requireStaff,
  h(async (req, res) => {
    const term = str(req.body.term);
    const category = str(req.body.category);
    const planned = num(req.body.planned_classes);
    if (!term || !category || !planned) return bad(res, '期次、类别、计划班数必填');
    const r = await one<any>(
      `INSERT INTO term_plans(term, category, current_classes, planned_classes, waitlist_pressure, decision_note, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        term,
        category,
        num(req.body.current_classes) ?? 1,
        planned,
        num(req.body.waitlist_pressure) ?? 0,
        str(req.body.decision_note),
        req.user!.name,
      ]
    );
    await audit({
      entityType: 'term_plan',
      entityId: r.id,
      action: '下期课程规划',
      reason: `${term} ${category}：计划${planned}个班（${str(req.body.decision_note)}）`,
      actor: req.user!.name,
    });
    res.json(r);
  })
);

// ---------------- 学习记录 ----------------
analysisRouter.get(
  '/learning-records',
  h(async (req, res) => {
    const courseId = num(req.query.course_id);
    const rows = await query(
      `SELECT lr.*, s.name AS student_name, c.title AS course_title, c.category
       FROM learning_records lr
       JOIN students s ON s.id=lr.student_id
       JOIN courses c ON c.id=lr.course_id
       WHERE ($1::int IS NULL OR lr.course_id=$1)
       ORDER BY lr.generated_at DESC, lr.id DESC LIMIT 300`,
      [courseId]
    );
    res.json(rows);
  })
);

// ---------------- 流水档案 ----------------
analysisRouter.get(
  '/audit-logs',
  h(async (req, res) => {
    const entityType = str(req.query.entity_type as string);
    const kw = str(req.query.kw as string);
    const courseId = num(req.query.course_id);
    const rows = await query(
      `SELECT al.*, s.name AS student_name, c.title AS course_title
       FROM audit_logs al
       LEFT JOIN students s ON s.id=al.student_id
       LEFT JOIN courses c ON c.id=al.course_id
       WHERE ($1='' OR al.entity_type=$1)
         AND ($2::int IS NULL OR al.course_id=$2)
         AND ($3='' OR al.action ILIKE '%'||$3||'%' OR al.reason ILIKE '%'||$3||'%')
       ORDER BY al.created_at DESC, al.id DESC LIMIT 300`,
      [entityType, courseId, kw]
    );
    res.json(rows);
  })
);
