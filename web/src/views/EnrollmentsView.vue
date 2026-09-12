<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">报名与候补</div>
      <el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="openNew">新报名</el-button>
    </div>

    <div class="filter-bar" style="margin-bottom: 12px">
      <el-input v-model="filters.kw" placeholder="学员/课程名" clearable style="width: 180px" @change="load" />
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px" @change="load">
        <el-option v-for="s in ['已录取', '候补', '已退课', '已转班']" :key="s" :label="s" :value="s" />
      </el-select>
      <el-select v-model="filters.course_id" placeholder="课程" clearable style="width: 180px" @change="load">
        <el-option v-for="c in courses" :key="c.id" :label="c.title" :value="c.id" />
      </el-select>
    </div>

    <el-card shadow="never">
      <el-table :data="rows" v-loading="loading" size="small">
        <el-table-column prop="student_name" label="学员" width="90" />
        <el-table-column prop="course_title" label="课程" width="140" />
        <el-table-column prop="term" label="期次" width="120" />
        <el-table-column prop="age" label="年龄" width="60" />
        <el-table-column prop="level" label="基础水平" width="80" />
        <el-table-column prop="health_limits" label="健康限制" width="120" show-overflow-tooltip />
        <el-table-column prop="source" label="来源" width="90" />
        <el-table-column label="缴费" width="76">
          <template #default="{ row }">
            <el-tag :type="({ 已缴: 'success', 未缴: 'danger', 部分退: 'warning', 已退: 'info' } as Record<string, string>)[row.fee_status] as any" size="small">
              {{ row.fee_status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="({ 已录取: 'success', 候补: 'warning', 已退课: 'info', 已转班: 'info' } as Record<string, string>)[row.status] as any" size="small">
              {{ row.status }}{{ row.status === '候补' ? `#${row.waitlist_position}` : '' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="报名时间" width="150">
          <template #default="{ row }">{{ row.created_at?.replace('T', ' ').slice(0, 16) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openTimeline(row)">时间线</el-button>
            <template v-if="auth.canManage">
              <el-button v-if="row.fee_status === '未缴'" link type="success" size="small" @click="pay(row)">缴费</el-button>
              <el-button v-if="row.status === '候补'" link type="primary" size="small" @click="promote(row)">转正</el-button>
              <el-button v-if="['已录取', '候补'].includes(row.status)" link type="danger" size="small" @click="drop(row)">退课</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新报名 -->
    <el-dialog v-model="newDlg" title="新报名" width="520px">
      <el-form label-width="90px">
        <el-form-item label="学员" required>
          <el-select v-model="form.student_id" filterable style="width: 100%" placeholder="搜索学员">
            <el-option v-for="s in students" :key="s.id" :label="`${s.name}（${2026 - s.birth_year}岁）`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="课程" required>
          <el-select v-model="form.course_id" filterable style="width: 100%">
            <el-option
              v-for="c in courses.filter((x) => ['报名中', '已开班'].includes(x.status))"
              :key="c.id"
              :label="`${c.title}（${c.confirmed_count}/${c.capacity}${c.waitlist_count ? '，候补' + c.waitlist_count : ''}）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="基础水平">
          <el-select v-model="form.level" style="width: 100%">
            <el-option v-for="l in meta.levels" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="健康限制"><el-input v-model="form.health_limits" placeholder="默认取学员档案" /></el-form-item>
        <el-form-item label="报名来源">
          <el-select v-model="form.source" style="width: 100%">
            <el-option v-for="s in meta.sources" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false" title="课程已满时将自动进入候补队列，按报名顺序排队" />
      </el-form>
      <template #footer>
        <el-button @click="newDlg = false">取消</el-button>
        <el-button type="primary" @click="saveNew">提交报名</el-button>
      </template>
    </el-dialog>

    <!-- 报名时间线：请假/停课/转班/材料消耗/退费/补课 全关联 -->
    <el-drawer v-model="tlDrawer" size="560px" :title="tl ? `${tl.enrollment.student_name} · ${tl.enrollment.course_title} · 全程档案` : ''">
      <template v-if="tl">
        <el-descriptions :column="2" border size="small" style="margin-bottom: 14px">
          <el-descriptions-item label="状态">{{ tl.enrollment.status }}</el-descriptions-item>
          <el-descriptions-item label="缴费">{{ tl.enrollment.fee_status }}（{{ tl.enrollment.fee_amount }}元）</el-descriptions-item>
          <el-descriptions-item label="基础水平">{{ tl.enrollment.level }}</el-descriptions-item>
          <el-descriptions-item label="健康限制">{{ tl.enrollment.health_limits || '无' }}</el-descriptions-item>
        </el-descriptions>

        <el-tabs>
          <el-tab-pane label="全程时间线">
            <el-timeline style="padding-left: 4px">
              <el-timeline-item
                v-for="(item, i) in timelineItems"
                :key="i"
                :type="item.type"
                :timestamp="item.time"
              >
                <b>{{ item.title }}</b>
                <div v-if="item.desc" style="color: #909399; font-size: 12px">{{ item.desc }}</div>
              </el-timeline-item>
            </el-timeline>
          </el-tab-pane>
          <el-tab-pane :label="`考勤(${tl.attendances.length})`">
            <el-table :data="tl.attendances" size="small">
              <el-table-column label="课次" width="110">
                <template #default="{ row }">
                  第{{ row.session_no }}次
                  <el-tag v-if="row.is_makeup" type="warning" size="small">补</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="session_date" label="日期" width="100">
                <template #default="{ row }">{{ row.session_date?.slice(0, 10) }}</template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="80">
                <template #default="{ row }">
                  <el-tag :type="attType(row.status)" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="note" label="备注" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
          <el-tab-pane :label="`课程材料消耗(${tl.materialLogs.length})`">
            <el-table :data="tl.materialLogs" size="small">
              <el-table-column label="时间" width="140">
                <template #default="{ row }">{{ row.created_at?.replace('T', ' ').slice(0, 16) }}</template>
              </el-table-column>
              <el-table-column prop="material_name" label="材料" width="80" />
              <el-table-column label="变动" width="70">
                <template #default="{ row }">
                  <span :style="{ color: row.change_qty > 0 ? '#67c23a' : '#f56c6c' }">
                    {{ row.change_qty > 0 ? '+' : '' }}{{ row.change_qty }}{{ row.unit }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { api, errMsg } from '../api';
import { useMetaStore } from '../stores/meta';
import { useAuthStore } from '../stores/auth';

const meta = useMetaStore();
const auth = useAuthStore();
const rows = ref<any[]>([]);
const courses = ref<any[]>([]);
const students = ref<any[]>([]);
const loading = ref(false);
const newDlg = ref(false);
const filters = reactive({ kw: '', status: '', course_id: null as number | null });
const form = reactive({ student_id: null as number | null, course_id: null as number | null, level: '零基础', health_limits: '', source: '' });

const tlDrawer = ref(false);
const tl = ref<any>(null);
const timelineItems = ref<any[]>([]);

function attType(s: string) {
  return { 签到: 'success', 迟到: 'warning', 请假: 'info', 缺席: 'danger', 代签异常: 'danger', 停课: 'info', 未签到: 'info' }[s] as any;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/enrollments', { params: filters });
    rows.value = data;
  } finally {
    loading.value = false;
  }
}

async function loadRefs() {
  const [c, s] = await Promise.all([api.get('/courses'), api.get('/students')]);
  courses.value = c.data;
  students.value = s.data;
}

function openNew() {
  Object.assign(form, { student_id: null, course_id: null, level: '零基础', health_limits: '', source: '' });
  newDlg.value = true;
}

async function saveNew() {
  if (!form.student_id || !form.course_id) {
    ElMessage.warning('请选择学员与课程');
    return;
  }
  try {
    const { data } = await api.post('/enrollments', form);
    ElMessage.success(data.status === '候补' ? `课程已满，已进入候补第${data.waitlist_position}位` : '报名成功，已录取');
    newDlg.value = false;
    load();
    loadRefs();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function pay(row: any) {
  try {
    await api.post(`/enrollments/${row.id}/pay`);
    ElMessage.success('已登记缴费');
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function promote(row: any) {
  try {
    await api.post(`/enrollments/${row.id}/promote`, {});
    ElMessage.success('已转正');
    load();
  } catch (e: any) {
    if (e?.response?.status === 409) {
      try {
        const { value } = await ElMessageBox.prompt('课程已满，如需破格录取请填写原因：', '破格录取', {
          inputValidator: (v) => !!v || '请填写原因',
        });
        await api.post(`/enrollments/${row.id}/promote`, { override_reason: value });
        ElMessage.success('已破格录取');
        load();
      } catch {
        /* 取消 */
      }
    } else {
      ElMessage.error(errMsg(e));
    }
  }
}

async function drop(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(`确认 ${row.student_name} 退出「${row.course_title}」？`, '学员退课', {
      inputPlaceholder: '退课原因',
      inputValue: '学员主动退课',
      inputValidator: (v) => !!v || '请填写原因',
    });
    await api.post(`/enrollments/${row.id}/cancel`, { reason: value });
    ElMessage.success('已退课');
    load();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function openTimeline(row: any) {
  const { data } = await api.get(`/enrollments/${row.id}/timeline`);
  tl.value = data;
  // 汇总全程时间线：报名/考勤异常/请假/补课/停课/转班/退费/审计流水
  const items: any[] = [];
  const push = (time: string, title: string, desc: string, type = 'primary') => items.push({ time, title, desc, type });
  push(data.enrollment.created_at?.replace('T', ' ').slice(0, 16), '报名', `状态：${data.enrollment.status}，来源：${data.enrollment.source}`);
  for (const l of data.leaves) {
    push(l.created_at?.replace('T', ' ').slice(0, 16), `请假（${l.reason_type}）→ ${l.status}`, l.reason, l.status === '已批准' ? 'warning' : 'info');
  }
  for (const m of data.makeups) {
    push(m.created_at?.replace('T', ' ').slice(0, 16), `补课（${m.status}）`, m.note || '', m.status === '已完成' ? 'success' : 'warning');
  }
  for (const s of data.cancelledSessions) {
    push(s.session_date?.slice(0, 10), `第${s.session_no}次课停课`, s.cancel_reason, 'danger');
  }
  for (const t of data.transfers) {
    push(t.created_at?.replace('T', ' ').slice(0, 16), `转班：${t.from_title} → ${t.to_title}`, t.reason, 'warning');
  }
  for (const r of data.refunds) {
    push(r.created_at?.replace('T', ' ').slice(0, 16), `退费 ${r.amount}元（${r.reason_type}）→ ${r.status}`, r.reason, r.status === '已退费' ? 'success' : 'danger');
  }
  for (const a of data.attendances.filter((x: any) => ['代签异常', '缺席'].includes(x.status))) {
    push(a.session_date?.slice(0, 10), `考勤异常：${a.status}（第${a.session_no}次课）`, a.note, 'danger');
  }
  for (const a of data.audits) {
    push(a.created_at?.replace('T', ' ').slice(0, 16), `${a.action}（${a.actor}）`, a.reason, 'info');
  }
  // 去重排序（审计流水与上面实体可能有重复，但保留以展示完整轨迹）
  timelineItems.value = items
    .filter((i) => i.time)
    .sort((a, b) => (a.time < b.time ? -1 : 1));
  tlDrawer.value = true;
}

onMounted(() => {
  meta.load();
  load();
  loadRefs();
});
</script>
