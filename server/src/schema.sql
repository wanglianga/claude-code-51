-- 社区老年大学课程报名与请假补课系统 数据库结构
-- 全部使用 IF NOT EXISTS，应用启动时幂等执行

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','teacher')),
  teacher_id INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '女',
  birth_year INT NOT NULL,
  phone TEXT DEFAULT '',
  emergency_contact TEXT DEFAULT '',
  health_limits TEXT DEFAULT '',           -- 健康限制
  source TEXT NOT NULL DEFAULT '现场咨询',  -- 报名来源
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teachers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  phone TEXT DEFAULT '',
  max_weekly_sessions INT DEFAULT 6,       -- 每周最多课次（排班约束）
  status TEXT NOT NULL DEFAULT '在职'
);

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  room_type TEXT NOT NULL,                 -- 书画室/声乐室/舞蹈室/多功能厅/电教室
  capacity INT NOT NULL,
  equipment TEXT DEFAULT '',               -- 设备/乐器
  shared_with_community BOOLEAN DEFAULT TRUE, -- 是否与社区其他服务共用
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,                  -- 书法/声乐/舞蹈/手机摄影/健康讲座
  term TEXT NOT NULL,                      -- 期次，如 2026年秋季一期
  teacher_id INT REFERENCES teachers(id),
  room_id INT REFERENCES rooms(id),
  weekday INT NOT NULL,                    -- 1=周一 ... 7=周日
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  start_date DATE NOT NULL,
  total_sessions INT NOT NULL DEFAULT 10,
  capacity INT NOT NULL,
  fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  material_note TEXT DEFAULT '',           -- 乐器/材料需求说明
  status TEXT NOT NULL DEFAULT '报名中',    -- 报名中/已开班/已结课/已取消
  confirm_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  course_id INT NOT NULL REFERENCES courses(id),
  age INT NOT NULL,                        -- 报名时年龄
  level TEXT NOT NULL DEFAULT '零基础',     -- 基础水平
  health_limits TEXT DEFAULT '',           -- 报名时健康限制快照
  source TEXT NOT NULL DEFAULT '现场咨询',  -- 报名来源
  fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  fee_status TEXT NOT NULL DEFAULT '未缴',  -- 未缴/已缴/部分退/已退
  status TEXT NOT NULL DEFAULT '候补',      -- 候补/已录取/已退课/已转班
  waitlist_position INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, course_id)
);

CREATE TABLE IF NOT EXISTS course_sessions (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id),
  session_no INT NOT NULL,
  session_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room_id INT REFERENCES rooms(id),
  teacher_id INT REFERENCES teachers(id),
  status TEXT NOT NULL DEFAULT '正常',      -- 正常/已停课
  cancel_reason TEXT DEFAULT '',
  note TEXT DEFAULT '',                    -- 课堂备注（课次级）
  is_makeup_session BOOLEAN DEFAULT FALSE  -- 是否为补课课次
);

CREATE TABLE IF NOT EXISTS attendances (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES course_sessions(id),
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  status TEXT NOT NULL DEFAULT '未签到',    -- 签到/迟到/请假/缺席/代签异常/停课/未签到
  is_makeup BOOLEAN DEFAULT FALSE,         -- 本次为补课签到
  makeup_for_session_id INT REFERENCES course_sessions(id),
  check_in_time TIMESTAMPTZ,
  note TEXT DEFAULT '',                    -- 课堂备注（个人级）
  UNIQUE(session_id, enrollment_id)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  session_id INT NOT NULL REFERENCES course_sessions(id),
  reason_type TEXT NOT NULL,               -- 病假/事假/临时换班/其他
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '待审批',    -- 待审批/已批准/已拒绝
  handled_by TEXT DEFAULT '',
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS makeups (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  leave_request_id INT REFERENCES leave_requests(id),
  original_session_id INT NOT NULL REFERENCES course_sessions(id),
  makeup_session_id INT REFERENCES course_sessions(id),
  status TEXT NOT NULL DEFAULT '待安排',    -- 待安排/已安排/已完成/已失效
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  amount NUMERIC(10,2) NOT NULL,
  reason_type TEXT NOT NULL,               -- 课程取消/教师停课/教室冲突/材料不足/学员退课/病假/其他
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT '待审核',    -- 待审核/已退费/已拒绝
  handled_by TEXT DEFAULT '',
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id), -- 原报名记录
  new_enrollment_id INT REFERENCES enrollments(id),      -- 转入的新报名记录
  from_course_id INT NOT NULL REFERENCES courses(id),
  to_course_id INT NOT NULL REFERENCES courses(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '已完成',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  unit TEXT DEFAULT '份',
  per_student_qty NUMERIC(10,2) NOT NULL DEFAULT 1, -- 每学员每次课消耗量
  stock_qty NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS material_logs (
  id SERIAL PRIMARY KEY,
  material_id INT NOT NULL REFERENCES materials(id),
  session_id INT REFERENCES course_sessions(id),
  change_qty NUMERIC(10,2) NOT NULL,       -- 负为消耗，正为入库
  reason TEXT NOT NULL,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,                -- 作品展示/汇报演出
  event_date DATE NOT NULL,
  room_id INT REFERENCES rooms(id),
  rehearsal_count INT DEFAULT 0,           -- 排练次数
  costume_notes TEXT DEFAULT '',           -- 服装
  family_observers INT DEFAULT 0,          -- 家属观摩人数
  safety_plan TEXT DEFAULT '',             -- 现场安全预案
  status TEXT NOT NULL DEFAULT '筹备中',    -- 筹备中/已举办/已归档
  archive_note TEXT DEFAULT '',            -- 归档小结（进入课程档案）
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_participants (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES events(id),
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  role TEXT NOT NULL DEFAULT '参演',        -- 参演/工作人员
  UNIQUE(event_id, enrollment_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id SERIAL PRIMARY KEY,
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  course_id INT NOT NULL REFERENCES courses(id),
  teacher_id INT REFERENCES teachers(id),
  rating INT NOT NULL DEFAULT 5,           -- 教师对学员评价 1-5
  comment TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(enrollment_id, course_id)
);

CREATE TABLE IF NOT EXISTS learning_records (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id),
  course_id INT NOT NULL REFERENCES courses(id),
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  term TEXT NOT NULL,
  total_sessions INT NOT NULL,
  attended INT NOT NULL,
  late INT NOT NULL,
  leaves INT NOT NULL,
  absent INT NOT NULL,
  makeup_done INT NOT NULL,
  attendance_rate NUMERIC(5,2) NOT NULL,
  teacher_rating INT,
  teacher_comment TEXT DEFAULT '',
  refund_total NUMERIC(10,2) DEFAULT 0,
  reenroll_suggestion TEXT DEFAULT '',     -- 续报名建议
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(enrollment_id)
);

CREATE TABLE IF NOT EXISTS room_bookings (
  id SERIAL PRIMARY KEY,
  room_id INT NOT NULL REFERENCES rooms(id),
  booking_type TEXT NOT NULL,              -- 课程/排练/展演/社区服务
  ref_id INT,                              -- 关联课次/活动 id
  title TEXT NOT NULL,
  booking_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS term_plans (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  category TEXT NOT NULL,
  current_classes INT NOT NULL,
  planned_classes INT NOT NULL,
  waitlist_pressure NUMERIC(5,2) DEFAULT 0, -- 候补人数/容量
  decision_note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,   -- enrollment/leave/makeup/refund/transfer/session/material/event/course
  entity_id INT NOT NULL,
  action TEXT NOT NULL,        -- 创建请假/批准请假/安排补课/停课/转班/材料消耗...
  reason TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  course_id INT,
  student_id INT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON course_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_attendances_session ON attendances(session_id);
CREATE INDEX IF NOT EXISTS idx_attendances_enrollment ON attendances(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_course ON audit_logs(course_id);
CREATE INDEX IF NOT EXISTS idx_audit_student ON audit_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON room_bookings(room_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_material_logs_mid ON material_logs(material_id);

-- ============ 候补转正通知与报名校验（增量） ============
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS seat_no INT;              -- 座位号
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS proxy_name TEXT DEFAULT '';    -- 家属代办人
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS proxy_relation TEXT DEFAULT ''; -- 代办关系
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS proxy_phone TEXT DEFAULT '';   -- 代办人电话

CREATE TABLE IF NOT EXISTS promotion_offers (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id),
  enrollment_id INT NOT NULL REFERENCES enrollments(id),
  student_id INT NOT NULL REFERENCES students(id),
  queue_position INT,                      -- 推送时的候补位次
  level TEXT DEFAULT '',                   -- 基础水平（推送快照）
  status TEXT NOT NULL DEFAULT '待确认',    -- 待确认/已确认/已顺延/已过期/已取消
  reason TEXT DEFAULT '',                  -- 顺延/过期原因（保留）
  note TEXT DEFAULT '',                    -- 推送备注（名额来源：退课/长期请假）
  offered_by TEXT DEFAULT '系统',
  offered_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,                  -- 48小时确认期限
  responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_offers_course ON promotion_offers(course_id);
CREATE INDEX IF NOT EXISTS idx_offers_enrollment ON promotion_offers(enrollment_id);
