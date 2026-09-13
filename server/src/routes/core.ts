import { Router } from 'express';
import { query, one } from '../db';
import { h, bad, str, num } from '../helpers';
import { signToken, requireAuth, requireStaff } from '../auth';
import { verifyPassword } from '../password';
import { audit } from '../audit';

export const authRouter = Router();
export const coreRouter = Router();

// ---------------- 认证 ----------------
authRouter.post(
  '/login',
  h(async (req, res) => {
    const username = str(req.body.username);
    const password = str(req.body.password);
    if (!username || !password) return bad(res, '请输入用户名和密码');
    const user = await one<any>(`SELECT * FROM users WHERE username=$1`, [username]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return bad(res, '用户名或密码错误', 401);
    }
    const payload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      teacher_id: user.teacher_id,
    };
    res.json({ token: signToken(payload as any), user: payload });
  })
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ---------------- 下拉选项 ----------------
coreRouter.get(
  '/meta/options',
  h(async (_req, res) => {
    const [rooms, teachers, terms] = await Promise.all([
      query(`SELECT id, name, room_type, capacity FROM rooms ORDER BY id`),
      query(`SELECT id, name, specialty FROM teachers WHERE status='在职' ORDER BY id`),
      query(`SELECT DISTINCT term FROM courses ORDER BY term DESC`),
    ]);
    res.json({
      categories: ['书法', '声乐', '舞蹈', '手机摄影', '健康讲座'],
      levels: ['零基础', '初级', '中级', '高级'],
      sources: ['社区推荐', '海报宣传', '老学员介绍', '微信公众号', '现场咨询', '其他'],
      leaveReasonTypes: ['病假', '事假', '临时换班', '其他'],
      refundReasonTypes: ['课程取消', '教师停课', '教室冲突', '材料不足', '学员退课', '病假', '其他'],
      courseStatuses: ['报名中', '已开班', '已结课', '已取消'],
      eventTypes: ['作品展示', '汇报演出'],
      rooms,
      teachers,
      terms: terms.map((t: any) => t.term),
    });
  })
);

// ---------------- 学员 ----------------
coreRouter.get(
  '/students',
  h(async (req, res) => {
    const kw = str(req.query.kw);
    const rows = await query(
      `SELECT s.*, (SELECT COUNT(*)::int FROM enrollments e WHERE e.student_id=s.id AND e.status='已录取') AS active_courses
       FROM students s
       WHERE ($1='' OR s.name ILIKE '%'||$1||'%' OR s.phone ILIKE '%'||$1||'%')
       ORDER BY s.id`,
      [kw]
    );
    res.json(rows);
  })
);

coreRouter.post(
  '/students',
  requireStaff,
  h(async (req, res) => {
    const name = str(req.body.name);
    const birthYear = num(req.body.birth_year);
    if (!name || !birthYear) return bad(res, '姓名与出生年份必填');
    const r = await one<any>(
      `INSERT INTO students(name, gender, birth_year, phone, emergency_contact, health_limits, source, note)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        name,
        str(req.body.gender, '女'),
        birthYear,
        str(req.body.phone),
        str(req.body.emergency_contact),
        str(req.body.health_limits),
        str(req.body.source, '现场咨询'),
        str(req.body.note),
      ]
    );
    await audit({ entityType: 'student', entityId: r.id, action: '新增学员', actor: req.user!.name, studentId: r.id });
    res.json(r);
  })
);

coreRouter.put(
  '/students/:id',
  requireStaff,
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const r = await one<any>(
      `UPDATE students SET name=$1, gender=$2, birth_year=$3, phone=$4, emergency_contact=$5,
         health_limits=$6, source=$7, note=$8 WHERE id=$9 RETURNING *`,
      [
        str(req.body.name),
        str(req.body.gender, '女'),
        num(req.body.birth_year),
        str(req.body.phone),
        str(req.body.emergency_contact),
        str(req.body.health_limits),
        str(req.body.source, '现场咨询'),
        str(req.body.note),
        id,
      ]
    );
    if (!r) return bad(res, '学员不存在', 404);
    res.json(r);
  })
);

// 学员档案：报名信息 + 学习记录
coreRouter.get(
  '/students/:id/profile',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const student = await one(`SELECT * FROM students WHERE id=$1`, [id]);
    if (!student) return bad(res, '学员不存在', 404);
    const enrollments = await query(
      `SELECT e.*, c.title AS course_title, c.category, c.term, c.status AS course_status, t.name AS teacher_name
       FROM enrollments e JOIN courses c ON c.id=e.course_id LEFT JOIN teachers t ON t.id=c.teacher_id
       WHERE e.student_id=$1 ORDER BY e.created_at DESC`,
      [id]
    );
    const records = await query(
      `SELECT lr.*, c.title AS course_title, c.category FROM learning_records lr
       JOIN courses c ON c.id=lr.course_id WHERE lr.student_id=$1 ORDER BY lr.generated_at DESC`,
      [id]
    );
    res.json({ student, enrollments, records });
  })
);

// ---------------- 教师 ----------------
coreRouter.get(
  '/teachers',
  h(async (_req, res) => {
    res.json(
      await query(
        `SELECT t.*, (SELECT COUNT(*)::int FROM courses c WHERE c.teacher_id=t.id AND c.status IN ('报名中','已开班')) AS active_courses
         FROM teachers t ORDER BY t.id`
      )
    );
  })
);

coreRouter.post(
  '/teachers',
  requireStaff,
  h(async (req, res) => {
    const name = str(req.body.name);
    if (!name) return bad(res, '姓名必填');
    const r = await one<any>(
      `INSERT INTO teachers(name, specialty, phone, max_weekly_sessions) VALUES($1,$2,$3,$4) RETURNING *`,
      [name, str(req.body.specialty), str(req.body.phone), num(req.body.max_weekly_sessions) ?? 6]
    );
    res.json(r);
  })
);

// ---------------- 活动室 ----------------
coreRouter.get(
  '/rooms',
  h(async (_req, res) => res.json(await query(`SELECT * FROM rooms ORDER BY id`)))
);

coreRouter.post(
  '/rooms',
  requireStaff,
  h(async (req, res) => {
    const name = str(req.body.name);
    const capacity = num(req.body.capacity);
    if (!name || !capacity) return bad(res, '名称与容量必填');
    const r = await one<any>(
      `INSERT INTO rooms(name, room_type, capacity, equipment, shared_with_community, note)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        name,
        str(req.body.room_type, '教室'),
        capacity,
        str(req.body.equipment),
        req.body.shared_with_community !== false,
        str(req.body.note),
      ]
    );
    res.json(r);
  })
);

// 活动室占用日程
coreRouter.get(
  '/rooms/:id/bookings',
  h(async (req, res) => {
    const id = num(req.params.id)!;
    const rows = await query(
      `SELECT * FROM room_bookings WHERE room_id=$1 AND booking_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY booking_date, start_time LIMIT 100`,
      [id]
    );
    res.json(rows);
  })
);
