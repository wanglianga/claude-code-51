import { pool, query } from './db';
import { hashPassword } from './password';
import { weeklyDates, fmtDate } from './helpers';

/**
 * 演示数据：覆盖报名/候补/缴费/开班/考勤/请假/补课/停课/转班/退费/材料/展演/结课/学习记录/下期规划 全链路。
 * 仅当 users 表为空时执行。
 */
export async function seedIfEmpty() {
  const c = await query<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
  if (c[0].c > 0) return false;
  console.log('[seed] 空库，写入演示数据...');

  // ---------- 用户 ----------
  const users: Array<[string, string, string, string, number | null]> = [
    ['admin', 'admin123', '张建国（管理员）', 'admin', null],
    ['staff01', 'staff123', '王敏（工作人员）', 'staff', null],
    ['teacher01', 'teacher123', '陈砚秋（书法教师）', 'teacher', 1],
    ['teacher02', 'teacher123', '刘雅琴（声乐教师）', 'teacher', 2],
  ];
  for (const [username, pw, name, role, tid] of users) {
    await query(
      `INSERT INTO users(username, password_hash, name, role, teacher_id) VALUES($1,$2,$3,$4,$5)`,
      [username, hashPassword(pw), name, role, tid]
    );
  }

  // ---------- 教师 ----------
  const teachers: Array<[string, string, string, number]> = [
    ['陈砚秋', '书法', '13800000001', 4],
    ['刘雅琴', '声乐', '13800000002', 4],
    ['王丽娜', '舞蹈', '13800000003', 4],
    ['赵明轩', '手机摄影', '13800000004', 4],
    ['孙济民', '健康讲座', '13800000005', 2],
  ];
  for (const [name, sp, phone, max] of teachers) {
    await query(
      `INSERT INTO teachers(name, specialty, phone, max_weekly_sessions) VALUES($1,$2,$3,$4)`,
      [name, sp, phone, max]
    );
  }

  // ---------- 活动室 ----------
  const rooms: Array<[string, string, number, string, boolean]> = [
    ['书画室', '书画室', 20, '书画长案、笔墨纸砚柜、投影仪', true],
    ['声乐室', '声乐室', 25, '钢琴、音响、谱架', true],
    ['舞蹈室', '舞蹈室', 18, '把杆、镜面墙、音响', true],
    ['多功能厅', '多功能厅', 60, '舞台、灯光、投影、音响', true],
    ['电教室', '电教室', 24, '电脑、投影、无线网络', true],
  ];
  for (const [name, type, cap, eq, shared] of rooms) {
    await query(
      `INSERT INTO rooms(name, room_type, capacity, equipment, shared_with_community) VALUES($1,$2,$3,$4,$5)`,
      [name, type, cap, eq, shared]
    );
  }

  // ---------- 学员 ----------
  const students: Array<[string, string, number, string, string, string, string]> = [
    ['王秀兰', '女', 1952, '13910000001', '子女：王强 13811110001', '高血压', '社区推荐'],
    ['李国强', '男', 1948, '13910000002', '配偶：刘英 13811110002', '无', '海报宣传'],
    ['张美华', '女', 1955, '13910000003', '子女：张磊 13811110003', '膝关节不好', '老学员介绍'],
    ['刘志明', '男', 1950, '13910000004', '配偶：赵华 13811110004', '糖尿病', '微信公众号'],
    ['陈桂芳', '女', 1957, '13910000005', '子女：陈静 13811110005', '无', '现场咨询'],
    ['杨建军', '男', 1953, '13910000006', '配偶：周红 13811110006', '听力下降', '社区推荐'],
    ['赵玉梅', '女', 1949, '13910000007', '子女：赵鹏 13811110007', '无', '海报宣传'],
    ['孙德福', '男', 1946, '13910000008', '子女：孙丽 13811110008', '高血压、心脏支架术后', '老学员介绍'],
    ['周淑珍', '女', 1956, '13910000009', '配偶：吴刚 13811110009', '无', '微信公众号'],
    ['吴永强', '男', 1951, '13910000010', '子女：吴敏 13811110010', '腰椎不适', '现场咨询'],
    ['郑爱萍', '女', 1954, '13910000011', '子女：郑凯 13811110011', '无', '社区推荐'],
    ['冯建华', '男', 1958, '13910000012', '配偶：林芳 13811110012', '无', '海报宣传'],
    ['褚桂英', '女', 1960, '13910000013', '子女：褚阳 13811110013', '轻度白内障', '老学员介绍'],
    ['卫东', '男', 1959, '13910000014', '配偶：何静 13811110014', '无', '微信公众号'],
    ['蒋秀荣', '女', 1962, '13910000015', '子女：蒋涛 13811110015', '无', '现场咨询'],
    ['沈万山', '男', 1947, '13910000016', '子女：沈丹 13811110016', '高血压', '社区推荐'],
    ['韩春燕', '女', 1961, '13910000017', '配偶：许强 13811110017', '无', '海报宣传'],
    ['曹金凤', '女', 1955, '13910000018', '子女：曹阳 13811110018', '膝关节不好', '老学员介绍'],
  ];
  for (const [name, gender, by, phone, ec, hl, src] of students) {
    await query(
      `INSERT INTO students(name, gender, birth_year, phone, emergency_contact, health_limits, source)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [name, gender, by, phone, ec, hl, src]
    );
  }

  // ---------- 课程 ----------
  // [title, category, term, teacher_id, room_id, start_time, end_time, start_date, sessions, capacity, fee, material_note, status]
  const courses: Array<[string, string, string, number, number, string, string, string, number, number, number, string, string]> = [
    ['书法基础班', '书法', '2026年秋季一期', 1, 1, '09:00', '10:30', '2026-09-07', 10, 14, 200, '宣纸、墨汁、毛毡（社区统一采购）', '已开班'],
    ['声乐合唱班', '声乐', '2026年秋季一期', 2, 2, '14:00', '15:30', '2026-09-08', 10, 20, 240, '歌谱、钢琴伴奏', '已开班'],
    ['健身舞蹈班', '舞蹈', '2026年秋季一期', 3, 3, '09:30', '11:00', '2026-09-09', 10, 16, 260, '舞蹈鞋（自备或社区代购）', '已开班'],
    ['手机摄影班', '手机摄影', '2026年秋季一期', 4, 5, '14:00', '15:30', '2026-09-10', 10, 20, 180, '智能手机自备、练习相册', '已开班'],
    ['秋季健康讲座', '健康讲座', '2026年秋季一期', 5, 4, '09:00', '10:00', '2026-09-11', 8, 50, 60, '健康手册', '报名中'],
    ['手机摄影班（夏季）', '手机摄影', '2026年夏季一期', 4, 5, '14:00', '15:30', '2026-06-01', 8, 20, 160, '智能手机自备', '已结课'],
  ];
  const courseIds: number[] = [];
  for (const [title, cat, term, tid, rid, st, et, sd, ns, cap, fee, mat, status] of courses) {
    const weekday = new Date(sd + 'T00:00:00').getDay() || 7;
    const r = await query<{ id: number }>(
      `INSERT INTO courses(title, category, term, teacher_id, room_id, weekday, start_time, end_time,
         start_date, total_sessions, capacity, fee, material_note, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [title, cat, term, tid, rid, weekday, st, et, sd, ns, cap, fee, mat, status]
    );
    courseIds.push(r[0].id);
  }
  const [CALLIG, VOCAL, DANCE, PHOTO, HEALTH, SUMMER] = courseIds;

  // ---------- 课次（已开班/已结课课程） ----------
  const sessionIds: Record<number, number[]> = {};
  for (const cid of [CALLIG, VOCAL, DANCE, PHOTO, SUMMER]) {
    const course = (await query<any>(`SELECT * FROM courses WHERE id=$1`, [cid]))[0];
    const dates = weeklyDates(course.start_date, course.total_sessions);
    sessionIds[cid] = [];
    for (let i = 0; i < dates.length; i++) {
      const r = await query<{ id: number }>(
        `INSERT INTO course_sessions(course_id, session_no, session_date, start_time, end_time, room_id, teacher_id)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [cid, i + 1, dates[i], course.start_time, course.end_time, course.room_id, course.teacher_id]
      );
      sessionIds[cid].push(r[0].id);
      await query(
        `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
         VALUES($1,'课程',$2,$3,$4,$5,$6)`,
        [course.room_id, r[0].id, `${course.title} 第${i + 1}次课`, dates[i], course.start_time, course.end_time]
      );
    }
  }

  // ---------- 报名 ----------
  // [student_id, course_id, level, fee_status, status, waitlist_position, created_at]
  const enrollments: Array<[number, number, string, string, string, number | null, string]> = [
    // 书法班：容量14，18人报名 → 14 已录取 + 4 候补
    [1, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-20 09:00'],
    [2, CALLIG, '初级', '已缴', '已录取', null, '2026-08-20 09:30'],
    [3, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-20 10:00'],
    [5, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-20 10:30'],
    [6, CALLIG, '中级', '已缴', '已录取', null, '2026-08-21 09:00'],
    [7, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-21 09:20'],
    [9, CALLIG, '初级', '已缴', '已录取', null, '2026-08-21 10:00'],
    [11, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-21 11:00'],
    [13, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-22 09:00'],
    [15, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-22 09:30'],
    [16, CALLIG, '初级', '已缴', '已录取', null, '2026-08-22 10:00'],
    [17, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-23 09:00'],
    [18, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-23 09:30'],
    [4, CALLIG, '零基础', '已缴', '已录取', null, '2026-08-23 10:00'],
    [8, CALLIG, '零基础', '已缴', '候补', 1, '2026-08-24 09:00'],
    [10, CALLIG, '零基础', '已缴', '候补', 2, '2026-08-24 10:00'],
    [12, CALLIG, '零基础', '未缴', '候补', 3, '2026-08-25 09:00'],
    [14, CALLIG, '零基础', '已缴', '候补', 4, '2026-08-25 10:00'],
    // 声乐班：容量20，18人报名全部录取
    [1, VOCAL, '初级', '已缴', '已录取', null, '2026-08-20 08:30'],
    [3, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-20 11:00'],
    [5, VOCAL, '中级', '已缴', '已录取', null, '2026-08-21 08:30'],
    [7, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-21 13:00'],
    [9, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-22 08:30'],
    [11, VOCAL, '初级', '已缴', '已录取', null, '2026-08-22 13:00'],
    [13, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-23 08:30'],
    [15, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-23 13:00'],
    [17, VOCAL, '初级', '已缴', '已录取', null, '2026-08-24 08:30'],
    [2, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-24 13:00'],
    [4, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-25 08:30'],
    [6, VOCAL, '中级', '已缴', '已录取', null, '2026-08-25 13:00'],
    [8, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-26 08:30'],
    [10, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-26 13:00'],
    [14, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-27 08:30'],
    [16, VOCAL, '初级', '已缴', '已录取', null, '2026-08-27 13:00'],
    [18, VOCAL, '零基础', '已缴', '已录取', null, '2026-08-28 08:30'],
    [12, VOCAL, '零基础', '已缴', '已退课', null, '2026-08-28 13:00'], // 退课 → 退费待审核
    // 舞蹈班：容量16，10人在读 + 1人转班
    [1, DANCE, '零基础', '已缴', '已录取', null, '2026-08-21 09:00'],
    [3, DANCE, '初级', '已缴', '已录取', null, '2026-08-21 09:30'],
    [5, DANCE, '零基础', '已缴', '已录取', null, '2026-08-22 09:00'],
    [7, DANCE, '零基础', '已缴', '已录取', null, '2026-08-22 09:40'],
    [9, DANCE, '零基础', '已缴', '已录取', null, '2026-08-23 09:00'],
    [11, DANCE, '初级', '已缴', '已录取', null, '2026-08-23 09:40'],
    [13, DANCE, '零基础', '已缴', '已录取', null, '2026-08-24 09:00'],
    [15, DANCE, '零基础', '已缴', '已录取', null, '2026-08-24 09:40'],
    [17, DANCE, '零基础', '已缴', '已录取', null, '2026-08-25 09:00'],
    [18, DANCE, '零基础', '已缴', '已录取', null, '2026-08-25 09:40'],
    [10, DANCE, '零基础', '已缴', '已转班', null, '2026-08-21 10:00'], // 腰椎不适 → 转摄影班
    // 摄影班（秋季）：容量20
    [2, PHOTO, '零基础', '已缴', '已录取', null, '2026-08-22 10:00'],
    [4, PHOTO, '初级', '已缴', '已录取', null, '2026-08-22 11:00'],
    [6, PHOTO, '零基础', '已缴', '已录取', null, '2026-08-23 10:00'],
    [12, PHOTO, '零基础', '已缴', '已录取', null, '2026-08-24 10:00'],
    [14, PHOTO, '零基础', '已缴', '已录取', null, '2026-08-25 10:00'],
    [16, PHOTO, '零基础', '已缴', '已录取', null, '2026-08-26 10:00'],
    [8, PHOTO, '零基础', '已退', '已退课', null, '2026-08-23 11:00'], // 病假退课，已退费
    // 健康讲座：报名中
    [1, HEALTH, '零基础', '已缴', '已录取', null, '2026-09-01 09:00'],
    [2, HEALTH, '零基础', '已缴', '已录取', null, '2026-09-01 10:00'],
    [3, HEALTH, '零基础', '已缴', '已录取', null, '2026-09-02 09:00'],
    [4, HEALTH, '零基础', '已缴', '已录取', null, '2026-09-02 10:00'],
    [5, HEALTH, '零基础', '已缴', '已录取', null, '2026-09-03 09:00'],
    [6, HEALTH, '零基础', '已缴', '已录取', null, '2026-09-03 10:00'],
    [7, HEALTH, '零基础', '未缴', '已录取', null, '2026-09-04 09:00'],
    [8, HEALTH, '零基础', '未缴', '已录取', null, '2026-09-04 10:00'],
    // 夏季摄影班（已结课）：8人
    [1, SUMMER, '零基础', '已缴', '已录取', null, '2026-05-10 09:00'],
    [2, SUMMER, '零基础', '已缴', '已录取', null, '2026-05-10 10:00'],
    [5, SUMMER, '初级', '已缴', '已录取', null, '2026-05-11 09:00'],
    [7, SUMMER, '零基础', '已缴', '已录取', null, '2026-05-11 10:00'],
    [9, SUMMER, '零基础', '已缴', '已录取', null, '2026-05-12 09:00'],
    [11, SUMMER, '零基础', '已缴', '已录取', null, '2026-05-12 10:00'],
    [13, SUMMER, '零基础', '部分退', '已录取', null, '2026-05-13 09:00'],
    [15, SUMMER, '零基础', '已缴', '已录取', null, '2026-05-13 10:00'],
  ];

  const enrollId: Record<string, number> = {};
  for (const [sid, cid, level, feeStatus, status, wp, createdAt] of enrollments) {
    const stu = (await query<any>(`SELECT * FROM students WHERE id=$1`, [sid]))[0];
    const course = (await query<any>(`SELECT * FROM courses WHERE id=$1`, [cid]))[0];
    const fee = feeStatus === '已退' ? course.fee : course.fee;
    const r = await query<{ id: number }>(
      `INSERT INTO enrollments(student_id, course_id, age, level, health_limits, source,
         fee_amount, fee_status, status, waitlist_position, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [sid, cid, 2026 - stu.birth_year, level, stu.health_limits, stu.source, fee, feeStatus, status, wp, createdAt]
    );
    enrollId[`${sid}-${cid}`] = r[0].id;
    await query(
      `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, student_id, created_at)
       VALUES('enrollment',$1,'学员报名',$2,'王敏',$3,$4,$5)`,
      [r[0].id, status === '候补' ? `课程已满，进入候补队列第${wp}位` : '报名并录取', cid, sid, createdAt]
    );
  }

  // ---------- 考勤 ----------
  const att = async (
    sid: number,
    cid: number,
    sessionIdx: number,
    status: string,
    note = '',
    opts: { makeup?: boolean; makeupFor?: number; time?: string } = {}
  ) => {
    const eid = enrollId[`${sid}-${cid}`];
    const sessionId = sessionIds[cid][sessionIdx];
    await query(
      `INSERT INTO attendances(session_id, enrollment_id, status, is_makeup, makeup_for_session_id, check_in_time, note)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (session_id, enrollment_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note`,
      [
        sessionId,
        eid,
        status,
        opts.makeup ?? false,
        opts.makeupFor ?? null,
        ['签到', '迟到'].includes(status) ? `${await sessionDate(sessionId)} 09:05` : null,
        note,
      ]
    );
  };
  const sessionDate = async (id: number) =>
    (await query<any>(`SELECT session_date::text AS d FROM course_sessions WHERE id=$1`, [id]))[0].d;

  // 书法第1次课（2026-09-07）：迟到/请假/代签异常/缺席 各一
  await att(1, CALLIG, 0, '签到');
  await att(2, CALLIG, 0, '签到');
  await att(3, CALLIG, 0, '迟到', '雨天路滑晚到10分钟');
  await att(5, CALLIG, 0, '签到');
  await att(6, CALLIG, 0, '请假', '感冒发烧（病假已批准）');
  await att(7, CALLIG, 0, '签到');
  await att(9, CALLIG, 0, '代签异常', '家属代签，已电话核实本人未到，记为异常');
  await att(11, CALLIG, 0, '签到');
  await att(13, CALLIG, 0, '签到');
  await att(15, CALLIG, 0, '签到');
  await att(16, CALLIG, 0, '缺席', '未请假未到课');
  await att(17, CALLIG, 0, '签到');
  await att(18, CALLIG, 0, '签到');
  await att(4, CALLIG, 0, '签到');

  // 声乐第1次课（2026-09-08）：教室冲突 → 停课
  await query(
    `UPDATE course_sessions SET status='已停课', cancel_reason='教室冲突：多功能厅维修借用声乐室，本课次无法上课' WHERE id=$1`,
    [sessionIds[VOCAL][0]]
  );
  const vocalEnrolled = enrollments.filter((e) => e[1] === VOCAL && e[4] === '已录取');
  for (const [sid] of vocalEnrolled) {
    await query(
      `INSERT INTO attendances(session_id, enrollment_id, status, note) VALUES($1,$2,'停课','教室冲突停课')`,
      [sessionIds[VOCAL][0], enrollId[`${sid}-${VOCAL}`]]
    );
  }
  // 补授课次：排在最后一次课之后一周
  const vocalCourse = (await query<any>(`SELECT * FROM courses WHERE id=$1`, [VOCAL]))[0];
  const lastDate = (await query<any>(`SELECT MAX(session_date)::text AS d FROM course_sessions WHERE course_id=$1`, [VOCAL]))[0].d;
  const makeupDate = fmtDate(new Date(new Date(lastDate).getTime() + 7 * 86400000));
  const mk = await query<{ id: number }>(
    `INSERT INTO course_sessions(course_id, session_no, session_date, start_time, end_time, room_id, teacher_id, is_makeup_session, note)
     VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,'补课：原第1次课（教室冲突）') RETURNING id`,
    [VOCAL, 11, makeupDate, vocalCourse.start_time, vocalCourse.end_time, vocalCourse.room_id, vocalCourse.teacher_id]
  );
  await query(
    `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
     VALUES($1,'课程',$2,$3,$4,$5,$6)`,
    [vocalCourse.room_id, mk[0].id, `${vocalCourse.title} 补课（原第1次课）`, makeupDate, vocalCourse.start_time, vocalCourse.end_time]
  );
  await query(
    `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, created_at)
     VALUES('session',$1,'教室冲突停课','多功能厅维修临时借用声乐室，第1次课停课并安排补课','王敏',$2,'2026-09-07 16:00')`,
    [sessionIds[VOCAL][0], VOCAL]
  );

  // 舞蹈第1次课（2026-09-09）：正常
  for (const sid of [1, 3, 5, 7, 9, 11, 13, 15, 17]) await att(sid, DANCE, 0, '签到');
  await att(18, DANCE, 0, '迟到', '公交晚点');

  // 摄影第1次课（2026-09-10）：正常
  for (const sid of [2, 4, 6, 12, 14, 16]) await att(sid, PHOTO, 0, '签到');

  // 夏季摄影班：全期考勤
  const summerStudents = [1, 2, 5, 7, 9, 11, 13, 15];
  for (let i = 0; i < 8; i++) {
    for (const sid of summerStudents) {
      if (sid === 9 && i === 2) continue; // 周淑珍 第3次课病假
      if (sid === 15 && i === 4) {
        await att(sid, SUMMER, i, '缺席', '未请假未到课');
        continue;
      }
      if (sid === 2 && i === 1) {
        await att(sid, SUMMER, i, '迟到', '迟到15分钟');
        continue;
      }
      if (sid === 13 && i === 5) continue; // 褚桂英 第6次课病假未补课（退费）
      await att(sid, SUMMER, i, '签到');
    }
  }
  await att(9, SUMMER, 2, '请假', '病假：感冒发烧');
  await att(13, SUMMER, 5, '请假', '病假：白内障复查');

  // ---------- 请假 ----------
  // 1) 杨建军 书法第1次课 病假（已批准 → 补课已安排到第2次课）
  const lv1 = await query<{ id: number }>(
    `INSERT INTO leave_requests(enrollment_id, session_id, reason_type, reason, status, handled_by, handled_at, created_at)
     VALUES($1,$2,'病假','感冒发烧，社区医院开具病假条','已批准','王敏','2026-09-07 08:30','2026-09-07 08:00') RETURNING id`,
    [enrollId['6-' + CALLIG], sessionIds[CALLIG][0]]
  );
  await query(
    `INSERT INTO makeups(enrollment_id, leave_request_id, original_session_id, makeup_session_id, status, note)
     VALUES($1,$2,$3,$4,'已安排','随第2次课补前半节内容')`,
    [enrollId['6-' + CALLIG], lv1[0].id, sessionIds[CALLIG][0], sessionIds[CALLIG][1]]
  );
  await query(
    `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, student_id, created_at)
     VALUES('leave',$1,'批准请假','病假：感冒发烧，安排随下次课补课','王敏',$2,6,'2026-09-07 08:30')`,
    [lv1[0].id, CALLIG]
  );
  // 2) 周淑珍 声乐第2次课 事假（已批准 → 补课待安排）
  const lv2 = await query<{ id: number }>(
    `INSERT INTO leave_requests(enrollment_id, session_id, reason_type, reason, status, handled_by, handled_at, created_at)
     VALUES($1,$2,'事假','子女搬家需帮忙','已批准','王敏','2026-09-11 10:00','2026-09-10 15:00') RETURNING id`,
    [enrollId['9-' + VOCAL], sessionIds[VOCAL][1]]
  );
  await query(
    `INSERT INTO makeups(enrollment_id, leave_request_id, original_session_id, status, note)
     VALUES($1,$2,$3,'待安排','')`,
    [enrollId['9-' + VOCAL], lv2[0].id, sessionIds[VOCAL][1]]
  );
  // 3) 张美华 书法第2次课 病假（待审批 —— 演示审批流）
  await query(
    `INSERT INTO leave_requests(enrollment_id, session_id, reason_type, reason, status, created_at)
     VALUES($1,$2,'病假','膝盖复查，需请假一次','待审批','2026-09-11 16:00')`,
    [enrollId['3-' + CALLIG], sessionIds[CALLIG][1]]
  );
  // 4) 夏季班 周淑珍 病假（已批准 → 补课已完成）
  const lv4 = await query<{ id: number }>(
    `INSERT INTO leave_requests(enrollment_id, session_id, reason_type, reason, status, handled_by, handled_at, created_at)
     VALUES($1,$2,'病假','感冒发烧','已批准','王敏','2026-06-15 08:30','2026-06-15 08:00') RETURNING id`,
    [enrollId['9-' + SUMMER], sessionIds[SUMMER][2]]
  );
  const summerMakeupDate = fmtDate(new Date('2026-07-27T00:00:00'));
  const smk = await query<{ id: number }>(
    `INSERT INTO course_sessions(course_id, session_no, session_date, start_time, end_time, room_id, teacher_id, is_makeup_session, note)
     VALUES($1,9,$2,'14:00','15:30',5,4,TRUE,'补课：原第3次课（学员病假）') RETURNING id`,
    [SUMMER, summerMakeupDate]
  );
  await query(
    `INSERT INTO makeups(enrollment_id, leave_request_id, original_session_id, makeup_session_id, status, note)
     VALUES($1,$2,$3,$4,'已完成','补课后正常签到')`,
    [enrollId['9-' + SUMMER], lv4[0].id, sessionIds[SUMMER][2], smk[0].id]
  );
  await query(
    `INSERT INTO attendances(session_id, enrollment_id, status, is_makeup, makeup_for_session_id, check_in_time, note)
     VALUES($1,$2,'签到',TRUE,$3,'2026-07-27 14:05','补课签到')`,
    [smk[0].id, enrollId['9-' + SUMMER], sessionIds[SUMMER][2]]
  );
  // 5) 夏季班 褚桂英 病假未补课（已批准 → 按次退费）
  const lv5 = await query<{ id: number }>(
    `INSERT INTO leave_requests(enrollment_id, session_id, reason_type, reason, status, handled_by, handled_at, created_at)
     VALUES($1,$2,'病假','白内障复查','已批准','王敏','2026-07-06 08:30','2026-07-05 15:00') RETURNING id`,
    [enrollId['13-' + SUMMER], sessionIds[SUMMER][5]]
  );
  await query(
    `INSERT INTO makeups(enrollment_id, leave_request_id, original_session_id, status, note)
     VALUES($1,$2,$3,'已失效','学员表示不再补课，按单次课退费处理')`,
    [enrollId['13-' + SUMMER], lv5[0].id, sessionIds[SUMMER][5]]
  );

  // ---------- 退费 ----------
  // 1) 孙德福 摄影班 病假退课（已退费）
  await query(
    `INSERT INTO refunds(enrollment_id, amount, reason_type, reason, status, handled_by, handled_at, created_at)
     VALUES($1,180,'病假','心脏支架术后住院调理，无法继续上课，全额退费','已退费','张建国','2026-09-05 10:00','2026-09-04 09:00')`,
    [enrollId['8-' + PHOTO]]
  );
  // 2) 冯建华 声乐班 学员退课（待审核 —— 演示审核流）
  await query(
    `INSERT INTO refunds(enrollment_id, amount, reason_type, reason, status, created_at)
     VALUES($1,240,'学员退课','随子女迁居外地，申请全额退费','待审核','2026-09-10 11:00')`,
    [enrollId['12-' + VOCAL]]
  );
  // 3) 褚桂英 夏季班 病假单次退费（已退费）
  await query(
    `INSERT INTO refunds(enrollment_id, amount, reason_type, reason, status, handled_by, handled_at, created_at)
     VALUES($1,20,'病假','第6次课病假未补课，按单次课退费 160/8=20 元','已退费','张建国','2026-07-08 10:00','2026-07-07 09:00')`,
    [enrollId['13-' + SUMMER]]
  );
  await query(
    `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, student_id, created_at)
     VALUES('refund',1,'退费审核','心脏支架术后住院，全额退费180元','张建国',$1,8,'2026-09-05 10:00')`,
    [PHOTO]
  );

  // ---------- 转班 ----------
  const newEn = await query<{ id: number }>(
    `INSERT INTO enrollments(student_id, course_id, age, level, health_limits, source, fee_amount, fee_status, status, created_at)
     VALUES(10,$1,75,'零基础','腰椎不适','现场咨询',180,'已缴','已录取','2026-09-02 10:00') RETURNING id`,
    [PHOTO]
  );
  await query(
    `INSERT INTO transfers(enrollment_id, new_enrollment_id, from_course_id, to_course_id, reason, created_by, created_at)
     VALUES($1,$2,$3,$4,'腰椎不适，医生建议减少舞蹈运动，转入手机摄影班','王敏','2026-09-02 10:00')`,
    [enrollId['10-' + DANCE], newEn[0].id, DANCE, PHOTO]
  );
  enrollId['10-' + PHOTO] = newEn[0].id;
  await query(
    `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, student_id, created_at)
     VALUES('transfer',1,'临时换班','腰椎不适，舞蹈班 → 手机摄影班，费用差额80元已现场补缴','王敏',$1,10,'2026-09-02 10:00')`,
    [PHOTO]
  );

  // ---------- 材料 ----------
  // [course_id, name, unit, per_student, stock]
  const materials: Array<[number, string, string, number, number]> = [
    [CALLIG, '宣纸', '刀', 1, 30],
    [CALLIG, '墨汁', '瓶', 0.2, 8],
    [VOCAL, '歌谱', '份', 1, 10], // 库存不足预警：18人/次 需18份
    [DANCE, '舞蹈鞋', '双', 1, 20],
    [PHOTO, '练习相册', '本', 1, 25],
    [HEALTH, '健康手册', '本', 1, 60],
  ];
  const matIds: Record<string, number> = {};
  for (const [cid, name, unit, per, stock] of materials) {
    const r = await query<{ id: number }>(
      `INSERT INTO materials(course_id, name, unit, per_student_qty, stock_qty) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [cid, name, unit, per, stock]
    );
    matIds[`${cid}-${name}`] = r[0].id;
  }
  // 书法第1次课消耗：14人 → 宣纸14刀、墨汁2.8瓶
  await query(
    `INSERT INTO material_logs(material_id, session_id, change_qty, reason, created_by, created_at)
     VALUES($1,$2,-14,'第1次课消耗（14人到课）','陈砚秋','2026-09-07 10:30')`,
    [matIds[`${CALLIG}-宣纸`], sessionIds[CALLIG][0]]
  );
  await query(`UPDATE materials SET stock_qty=stock_qty-14 WHERE id=$1`, [matIds[`${CALLIG}-宣纸`]]);
  await query(
    `INSERT INTO material_logs(material_id, session_id, change_qty, reason, created_by, created_at)
     VALUES($1,$2,-2.8,'第1次课消耗（14人到课）','陈砚秋','2026-09-07 10:30')`,
    [matIds[`${CALLIG}-墨汁`], sessionIds[CALLIG][0]]
  );
  await query(`UPDATE materials SET stock_qty=stock_qty-2.8 WHERE id=$1`, [matIds[`${CALLIG}-墨汁`]]);
  // 舞蹈第1次课发放舞蹈鞋10双
  await query(
    `INSERT INTO material_logs(material_id, session_id, change_qty, reason, created_by, created_at)
     VALUES($1,$2,-10,'第1次课发放舞蹈鞋（10人到课）','王丽娜','2026-09-09 11:00')`,
    [matIds[`${DANCE}-舞蹈鞋`], sessionIds[DANCE][0]]
  );
  await query(`UPDATE materials SET stock_qty=stock_qty-10 WHERE id=$1`, [matIds[`${DANCE}-舞蹈鞋`]]);
  await query(
    `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, created_at)
     VALUES('material',$1,'材料消耗','第1次课消耗宣纸14刀、墨汁2.8瓶（14人到课）','陈砚秋',$2,'2026-09-07 10:30')`,
    [matIds[`${CALLIG}-宣纸`], CALLIG]
  );

  // ---------- 展演活动 ----------
  const ev1 = await query<{ id: number }>(
    `INSERT INTO events(course_id, title, event_type, event_date, room_id, rehearsal_count, costume_notes,
       family_observers, safety_plan, status)
     VALUES($1,'金秋合唱汇报演出','汇报演出','2026-11-21',4,3,'统一红色围巾与白色上衣',45,
       '安排4名志愿者维持秩序，多功能厅两个安全出口保持畅通，配备急救药箱，演出前检查舞台用电安全','筹备中') RETURNING id`,
    [VOCAL]
  );
  for (const [sid] of vocalEnrolled) {
    await query(
      `INSERT INTO event_participants(event_id, enrollment_id, role) VALUES($1,$2,'参演') ON CONFLICT DO NOTHING`,
      [ev1[0].id, enrollId[`${sid}-${VOCAL}`]]
    );
  }
  await query(
    `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
     VALUES(4,'展演',$1,'金秋合唱汇报演出','2026-11-21','14:00','16:00')`,
    [ev1[0].id]
  );
  const ev2 = await query<{ id: number }>(
    `INSERT INTO events(course_id, title, event_type, event_date, room_id, rehearsal_count, costume_notes,
       family_observers, safety_plan, status)
     VALUES($1,'秋季学员书法作品展','作品展示','2026-11-28',4,0,'',30,
       '作品装裱牢固，观展路线单向通行，现场安排2名工作人员引导','筹备中') RETURNING id`,
    [CALLIG]
  );
  for (const sid of [1, 2, 3, 5, 6, 7, 9, 11, 13, 15]) {
    await query(
      `INSERT INTO event_participants(event_id, enrollment_id, role) VALUES($1,$2,'参演') ON CONFLICT DO NOTHING`,
      [ev2[0].id, enrollId[`${sid}-${CALLIG}`]]
    );
  }
  await query(
    `INSERT INTO room_bookings(room_id, booking_type, ref_id, title, booking_date, start_time, end_time)
     VALUES(4,'展演',$1,'秋季学员书法作品展','2026-11-28','09:00','17:00')`,
    [ev2[0].id]
  );

  // ---------- 教师评价（夏季班全员 + 书法班部分） ----------
  const summerComments: Record<number, [number, string]> = {
    1: [5, '学习认真，构图进步明显，作品《荷塘晨曦》入选社区展览'],
    2: [4, '基础扎实，建议多练习夜景拍摄'],
    5: [5, '零基础起步，进步最快，出勤全勤'],
    7: [4, '掌握良好，建议下期继续深造'],
    9: [5, '病假后主动补课，学习态度值得表扬'],
    11: [4, '作品稳定，建议尝试人像摄影'],
    13: [3, '因身体原因缺课较多，建议下期复查后量力而行'],
    15: [3, '有一次无故缺席，已电话提醒'],
  };
  for (const sid of summerStudents) {
    const [rating, comment] = summerComments[sid];
    await query(
      `INSERT INTO evaluations(enrollment_id, course_id, teacher_id, rating, comment, created_at)
       VALUES($1,$2,4,$3,$4,'2026-07-25 10:00')`,
      [enrollId[`${sid}-${SUMMER}`], SUMMER, rating, comment]
    );
  }
  await query(
    `INSERT INTO evaluations(enrollment_id, course_id, teacher_id, rating, comment)
     VALUES($1,$2,1,5,'笔法进步明显，可尝试行书入门')`,
    [enrollId['1-' + CALLIG], CALLIG]
  );

  // ---------- 夏季班学习记录（结课产出） ----------
  const summerRecords: Array<[number, number, number, number, number, number, number, number, string]> = [
    // [student_id, attended, late, leaves, absent, makeup_done, rate, rating, suggestion]
    [1, 8, 0, 0, 0, 0, 100, 5, '出勤优秀，建议续报进阶课程'],
    [2, 7, 1, 0, 0, 0, 100, 4, '出勤优秀，建议续报进阶课程'],
    [5, 8, 0, 0, 0, 0, 100, 5, '出勤优秀，建议续报进阶课程'],
    [7, 8, 0, 0, 0, 0, 100, 4, '出勤优秀，建议续报进阶课程'],
    [9, 7, 0, 1, 0, 1, 87.5, 5, '出勤优秀，建议续报进阶课程'],
    [11, 8, 0, 0, 0, 0, 100, 4, '出勤优秀，建议续报进阶课程'],
    [13, 7, 0, 1, 0, 0, 87.5, 3, '出勤优秀，建议续报进阶课程'],
    [15, 7, 0, 0, 1, 0, 87.5, 3, '出勤优秀，建议续报进阶课程'],
  ];
  for (const [sid, attended, late, leaves, absent, mkDone, rate, rating, sugg] of summerRecords) {
    const eid = enrollId[`${sid}-${SUMMER}`];
    const refundTotal = sid === 13 ? 20 : 0;
    await query(
      `INSERT INTO learning_records(student_id, course_id, enrollment_id, term, total_sessions,
         attended, late, leaves, absent, makeup_done, attendance_rate, teacher_rating, teacher_comment,
         refund_total, reenroll_suggestion, generated_at)
       VALUES($1,$2,$3,'2026年夏季一期',8,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'2026-07-28 10:00')`,
      [
        sid, SUMMER, eid, attended, late, leaves, absent, mkDone, rate, rating,
        summerComments[sid][1], refundTotal, sugg,
      ]
    );
  }
  await query(
    `INSERT INTO audit_logs(entity_type, entity_id, action, reason, actor, course_id, created_at)
     VALUES('course',$1,'课程结课','夏季摄影班结课，生成8名学员学习记录','王敏',$1,'2026-07-28 10:00')`,
    [SUMMER]
  );

  // ---------- 社区其他服务占用（活动室资源关联） ----------
  const community: Array<[number, string, string, string, string]> = [
    [4, '社区电影放映', '2026-09-09', '14:00', '16:00'],
    [4, '社区电影放映', '2026-09-16', '14:00', '16:00'],
    [4, '社区电影放映', '2026-09-23', '14:00', '16:00'],
    [4, '社区电影放映', '2026-09-30', '14:00', '16:00'],
    [4, '党员活动日', '2026-09-18', '14:00', '16:00'],
    [4, '党员活动日', '2026-10-16', '14:00', '16:00'],
    [1, '社区剪纸兴趣组', '2026-09-10', '09:00', '11:00'],
    [1, '社区剪纸兴趣组', '2026-09-17', '09:00', '11:00'],
    [1, '社区剪纸兴趣组', '2026-09-24', '09:00', '11:00'],
    [3, '社区瑜伽班', '2026-09-11', '09:00', '10:30'],
    [3, '社区瑜伽班', '2026-09-18', '09:00', '10:30'],
    [3, '社区瑜伽班', '2026-09-25', '09:00', '10:30'],
    [2, '戏曲票友会', '2026-09-14', '14:00', '15:30'],
    [2, '戏曲票友会', '2026-09-21', '14:00', '15:30'],
  ];
  for (const [rid, title, date, st, et] of community) {
    await query(
      `INSERT INTO room_bookings(room_id, booking_type, title, booking_date, start_time, end_time)
       VALUES($1,'社区服务',$2,$3,$4,$5)`,
      [rid, title, date, st, et]
    );
  }

  // ---------- 下期规划 ----------
  await query(
    `INSERT INTO term_plans(term, category, current_classes, planned_classes, waitlist_pressure, decision_note, created_by)
     VALUES('2026年秋季二期','书法',1,2,0.29,'书法班候补4人且3人已缴费，候补反映真实需求，下期扩1个班','王敏')`
  );
  await query(
    `INSERT INTO term_plans(term, category, current_classes, planned_classes, waitlist_pressure, decision_note, created_by)
     VALUES('2026年秋季二期','声乐',1,1,0,'暂无候补，维持现有规模','王敏')`
  );

  console.log('[seed] 演示数据写入完成');
  return true;
}
