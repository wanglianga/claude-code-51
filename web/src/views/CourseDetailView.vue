<template>
  <div class="page" v-loading="loading">
    <template v-if="course">
      <div class="page-header">
        <div class="page-title">
          <el-button link :icon="ArrowLeft" @click="$router.push('/courses')">返回</el-button>
          {{ course.title }}
          <el-tag size="small" effect="plain" style="margin-left: 6px">{{ course.category }}</el-tag>
          <el-tag :type="statusType(course.status)" size="small" style="margin-left: 4px">{{ course.status }}</el-tag>
        </div>
        <div v-if="auth.canManage">
          <el-button v-if="course.status === '已开班'" type="warning" @click="completeCourse">结课并生成学习记录</el-button>
          <el-button v-if="['报名中', '已开班'].includes(course.status)" type="danger" plain @click="cancelCourse">取消课程</el-button>
        </div>
      </div>

      <el-descriptions :column="4" border size="small" style="margin-bottom: 14px">
        <el-descriptions-item label="期次">{{ course.term }}</el-descriptions-item>
        <el-descriptions-item label="教师">{{ course.teacher_name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="教室">{{ course.room_name }}（容量{{ course.room_capacity }}）</el-descriptions-item>
        <el-descriptions-item label="时间">周{{ '一二三四五六日'[course.weekday - 1] }} {{ course.start_time }}-{{ course.end_time }}</el-descriptions-item>
        <el-descriptions-item label="费用">{{ course.fee }} 元 / {{ course.total_sessions }}次</el-descriptions-item>
        <el-descriptions-item label="已录取">{{ course.counts?.confirmed ?? 0 }}/{{ course.capacity }}</el-descriptions-item>
        <el-descriptions-item label="候补">{{ course.counts?.waitlist ?? 0 }} 人</el-descriptions-item>
        <el-descriptions-item label="材料需求">{{ course.material_note || '-' }}</el-descriptions-item>
      </el-descriptions>

      <el-tabs v-model="tab">
        <!-- 名单 -->
        <el-tab-pane label="报名名单" name="roster">
          <el-card shadow="never">
            <el-table :data="enrollments" size="small">
              <el-table-column prop="student_name" label="学员" width="90" />
              <el-table-column prop="age" label="年龄" width="60" />
              <el-table-column prop="level" label="基础水平" width="80" />
              <el-table-column prop="health_limits" label="健康限制" width="130" show-overflow-tooltip />
              <el-table-column prop="source" label="报名来源" width="90" />
              <el-table-column label="缴费" width="80">
                <template #default="{ row }">
                  <el-tag :type="feeType(row.fee_status)" size="small">{{ row.fee_status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="enrollType(row.status)" size="small">
                    {{ row.status }}{{ row.status === '候补' ? `#${row.waitlist_position}` : '' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="教师评价" min-width="160">
                <template #default="{ row }">
                  <span v-if="row.eval_rating">
                    <el-rate :model-value="row.eval_rating" disabled size="small" style="display: inline-flex" />
                    <span style="font-size: 12px; color: #909399"> {{ row.eval_comment }}</span>
                  </span>
                  <span v-else style="color: #c0c4cc">未评价</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="220" fixed="right">
                <template #default="{ row }">
                  <template v-if="auth.canManage">
                    <el-button v-if="row.fee_status === '未缴'" link type="success" size="small" @click="pay(row)">缴费</el-button>
                    <el-button v-if="row.status === '候补'" link type="primary" size="small" @click="promote(row)">转正</el-button>
                    <el-button v-if="['已录取', '候补'].includes(row.status)" link type="danger" size="small" @click="drop(row)">退课</el-button>
                  </template>
                  <el-button v-if="row.status === '已录取'" link type="warning" size="small" @click="openEval(row)">评价</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>

        <!-- 开班确认 -->
        <el-tab-pane label="开班确认" name="precheck" :disabled="course.status !== '报名中'">
          <el-card shadow="never" v-loading="precheckLoading">
            <template #header>
              <b>开班前检查</b>
              <el-button size="small" style="margin-left: 10px" @click="loadPrecheck">重新检查</el-button>
            </template>
            <el-row :gutter="12" v-if="precheck">
              <el-col :xs="24" :md="12">
                <el-alert :type="precheck.room.ok ? 'success' : 'error'" :closable="false" class="chk">
                  <b>教室容量：</b>{{ precheck.room.name }} 容量 {{ precheck.room.capacity }}，
                  课程容量 {{ course.capacity }}（{{ precheck.room.ok ? '满足' : '不满足' }}）
                </el-alert>
                <el-alert :type="precheck.teacher.conflicts.length === 0 && precheck.teacher.loadOk ? 'success' : 'error'" :closable="false" class="chk">
                  <b>教师排班：</b>{{ precheck.teacher.name }} 本周已排 {{ precheck.teacher.weeklyLoad }}/{{ precheck.teacher.maxWeekly }} 门
                  <span v-if="precheck.teacher.conflicts.length">
                    ，冲突：{{ precheck.teacher.conflicts.map((c: any) => c.title).join('、') }}
                  </span>
                </el-alert>
                <el-alert :type="precheck.bookingConflicts.length === 0 ? 'success' : 'error'" :closable="false" class="chk">
                  <b>教室占用：</b>
                  <span v-if="!precheck.bookingConflicts.length">未来 {{ course.total_sessions }} 次课时段均空闲</span>
                  <span v-else>{{ precheck.bookingConflicts.join('；') }}</span>
                </el-alert>
              </el-col>
              <el-col :xs="24" :md="12">
                <el-alert :type="precheck.capacity.ok ? 'success' : 'warning'" :closable="false" class="chk">
                  <b>报名名单：</b>已录取 {{ precheck.capacity.confirmed }}/{{ precheck.capacity.course }}，
                  候补 {{ precheck.waitlist }} 人（按报名先后排队）
                </el-alert>
                <el-alert
                  v-for="m in precheck.materials"
                  :key="m.id"
                  :type="m.ok ? 'success' : 'error'"
                  :closable="false"
                  class="chk"
                >
                  <b>材料：</b>{{ m.name }} 库存 {{ m.stock_qty }}{{ m.unit }}，每次课需 {{ m.need_per_session }}{{ m.unit }}
                  （{{ m.ok ? '充足' : '不足' }}）
                </el-alert>
                <el-alert v-if="!precheck.materials?.length" type="info" :closable="false" class="chk">
                  <b>材料：</b>未配置材料
                </el-alert>
              </el-col>
            </el-row>
            <div style="margin-top: 14px" v-if="auth.canManage">
              <el-button type="primary" size="large" @click="confirmCourse">确认开班（生成课次）</el-button>
            </div>
          </el-card>
        </el-tab-pane>

        <!-- 课次 -->
        <el-tab-pane label="课次安排" name="sessions">
          <el-card shadow="never">
            <el-table :data="sessions" size="small">
              <el-table-column label="课次" width="90">
                <template #default="{ row }">
                  第{{ row.session_no }}次
                  <el-tag v-if="row.is_makeup_session" type="warning" size="small">补课</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="session_date" label="日期" width="110">
                <template #default="{ row }">{{ row.session_date?.slice(0, 10) }}</template>
              </el-table-column>
              <el-table-column label="时间" width="120">
                <template #default="{ row }">{{ row.start_time }}-{{ row.end_time }}</template>
              </el-table-column>
              <el-table-column prop="room_name" label="教室" width="90" />
              <el-table-column label="出勤" width="110">
                <template #default="{ row }">
                  <span style="color: #67c23a">{{ row.present_count }}到</span> /
                  <span style="color: #e6a23c">{{ row.leave_count }}请假</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="row.status === '已停课' ? 'danger' : 'success'" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="cancel_reason" label="停课原因/备注" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ row.cancel_reason || row.note || '-' }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="$router.push(`/attendance?session=${row.id}`)">
                    去考勤
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>

        <!-- 材料 -->
        <el-tab-pane label="材料管理" name="materials">
          <el-card shadow="never">
            <template #header>
              <b>材料库存</b>
              <el-button v-if="auth.canManage" size="small" type="primary" style="margin-left: 10px" @click="matDlg = true">添加材料</el-button>
            </template>
            <el-table :data="course.materials" size="small">
              <el-table-column prop="name" label="材料" width="120" />
              <el-table-column label="库存" width="110">
                <template #default="{ row }">
                  <span :style="{ color: row.stock_qty < row.per_student_qty * (course.counts?.confirmed || 0) ? '#f56c6c' : '#303133' }">
                    {{ row.stock_qty }}{{ row.unit }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="每人每次消耗" width="120">
                <template #default="{ row }">{{ row.per_student_qty }}{{ row.unit }}</template>
              </el-table-column>
              <el-table-column label="每次课需求" width="120">
                <template #default="{ row }">
                  {{ Math.round(row.per_student_qty * (course.counts?.confirmed || 0) * 100) / 100 }}{{ row.unit }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160">
                <template #default="{ row }">
                  <el-button v-if="auth.canManage" link type="primary" size="small" @click="openRestock(row)">入库</el-button>
                  <el-button link size="small" @click="showMatLogs(row)">流水</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>

        <!-- 展演 -->
        <el-tab-pane label="展演活动" name="events">
          <el-card shadow="never">
            <el-table :data="course.events" size="small">
              <el-table-column prop="title" label="活动" min-width="160" />
              <el-table-column prop="event_type" label="类型" width="90" />
              <el-table-column label="日期" width="110">
                <template #default="{ row }">{{ row.event_date?.slice(0, 10) }}</template>
              </el-table-column>
              <el-table-column prop="rehearsal_count" label="排练次数" width="80" />
              <el-table-column prop="family_observers" label="家属观摩" width="80" />
              <el-table-column prop="status" label="状态" width="90">
                <template #default="{ row }"><el-tag size="small">{{ row.status }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="archive_note" label="归档小结" min-width="160" show-overflow-tooltip />
            </el-table>
            <el-button style="margin-top: 10px" size="small" @click="$router.push('/events')">前往展演管理</el-button>
          </el-card>
        </el-tab-pane>
      </el-tabs>

      <!-- 评价对话框 -->
      <el-dialog v-model="evalDlg" title="教师评价" width="440px">
        <el-form label-width="70px">
          <el-form-item label="学员">{{ evalRow?.student_name }}</el-form-item>
          <el-form-item label="评分"><el-rate v-model="evalForm.rating" /></el-form-item>
          <el-form-item label="评语"><el-input v-model="evalForm.comment" type="textarea" :rows="3" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="evalDlg = false">取消</el-button>
          <el-button type="primary" @click="saveEval">保存</el-button>
        </template>
      </el-dialog>

      <!-- 材料对话框 -->
      <el-dialog v-model="matDlg" title="添加材料" width="420px">
        <el-form label-width="100px">
          <el-form-item label="名称"><el-input v-model="matForm.name" /></el-form-item>
          <el-form-item label="单位"><el-input v-model="matForm.unit" /></el-form-item>
          <el-form-item label="每人每次"><el-input-number v-model="matForm.per_student_qty" :min="0.1" :step="0.5" /></el-form-item>
          <el-form-item label="初始库存"><el-input-number v-model="matForm.stock_qty" :min="0" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="matDlg = false">取消</el-button>
          <el-button type="primary" @click="saveMaterial">保存</el-button>
        </template>
      </el-dialog>

      <!-- 入库对话框 -->
      <el-dialog v-model="restockDlg" title="材料入库" width="420px">
        <el-form label-width="80px">
          <el-form-item label="材料">{{ restockRow?.name }}</el-form-item>
          <el-form-item label="数量"><el-input-number v-model="restockForm.qty" :min="1" /></el-form-item>
          <el-form-item label="原因"><el-input v-model="restockForm.reason" placeholder="如：社区采购" /></el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="restockDlg = false">取消</el-button>
          <el-button type="primary" @click="saveRestock">入库</el-button>
        </template>
      </el-dialog>

      <!-- 材料流水 -->
      <el-drawer v-model="matLogDrawer" :title="`材料流水：${matLogRow?.name || ''}`" size="420px">
        <el-table :data="matLogs" size="small">
          <el-table-column label="时间" width="140">
            <template #default="{ row }">{{ row.created_at?.replace('T', ' ').slice(0, 16) }}</template>
          </el-table-column>
          <el-table-column label="变动" width="80">
            <template #default="{ row }">
              <span :style="{ color: row.change_qty > 0 ? '#67c23a' : '#f56c6c' }">
                {{ row.change_qty > 0 ? '+' : '' }}{{ row.change_qty }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" />
        </el-table>
      </el-drawer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft } from '@element-plus/icons-vue';
import { api, errMsg } from '../api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const auth = useAuthStore();
const id = Number(route.params.id);

const loading = ref(false);
const course = ref<any>(null);
const enrollments = ref<any[]>([]);
const sessions = ref<any[]>([]);
const precheck = ref<any>(null);
const precheckLoading = ref(false);
const tab = ref('roster');

const evalDlg = ref(false);
const evalRow = ref<any>(null);
const evalForm = reactive({ rating: 5, comment: '' });

const matDlg = ref(false);
const matForm = reactive({ name: '', unit: '份', per_student_qty: 1, stock_qty: 0 });
const restockDlg = ref(false);
const restockRow = ref<any>(null);
const restockForm = reactive({ qty: 10, reason: '' });
const matLogDrawer = ref(false);
const matLogRow = ref<any>(null);
const matLogs = ref<any[]>([]);

function statusType(s: string) {
  return { 报名中: 'warning', 已开班: 'success', 已结课: 'info', 已取消: 'danger' }[s] as any;
}
function feeType(s: string) {
  return { 已缴: 'success', 未缴: 'danger', 部分退: 'warning', 已退: 'info' }[s] as any;
}
function enrollType(s: string) {
  return { 已录取: 'success', 候补: 'warning', 已退课: 'info', 已转班: 'info' }[s] as any;
}

async function load() {
  loading.value = true;
  try {
    const [c, e, s] = await Promise.all([
      api.get(`/courses/${id}`),
      api.get(`/courses/${id}/enrollments`),
      api.get(`/courses/${id}/sessions`),
    ]);
    course.value = c.data;
    enrollments.value = e.data;
    sessions.value = s.data;
  } finally {
    loading.value = false;
  }
}

async function loadPrecheck() {
  precheckLoading.value = true;
  try {
    const { data } = await api.get(`/courses/${id}/precheck`);
    precheck.value = data;
  } finally {
    precheckLoading.value = false;
  }
}

async function confirmCourse() {
  try {
    await ElMessageBox.confirm('确认开班后将按周生成全部课次并占用教室时段，是否继续？', '确认开班', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await api.post(`/courses/${id}/confirm`, {});
    ElMessage.success('开班成功，课次已生成');
    load();
  } catch (e: any) {
    if (e?.response?.status === 409) {
      const problems = e.response.data.problems || [];
      try {
        const { value } = await ElMessageBox.prompt(
          `检查未通过：\n${problems.join('\n')}\n\n如需强制开班，请填写原因：`,
          '强制开班',
          { confirmButtonText: '强制开班', cancelButtonText: '取消', inputPlaceholder: '强制开班原因' }
        );
        await api.post(`/courses/${id}/confirm`, { override_reason: value });
        ElMessage.success('已强制开班');
        load();
      } catch {
        /* 取消 */
      }
    } else {
      ElMessage.error(errMsg(e));
    }
  }
}

async function completeCourse() {
  try {
    await ElMessageBox.confirm('结课后将汇总出勤/补课/教师评价/退费，生成学员学习记录，是否继续？', '课程结课', { type: 'warning' });
    await api.post(`/courses/${id}/complete`);
    ElMessage.success('已结课，学习记录已生成');
    load();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function cancelCourse() {
  try {
    const { value } = await ElMessageBox.prompt('取消课程将为已缴费学员生成全额退费申请，请填写取消原因：', '取消课程', {
      confirmButtonText: '确认取消课程',
      cancelButtonText: '返回',
      inputPlaceholder: '取消原因',
      inputValidator: (v) => !!v || '请填写原因',
    });
    await api.post(`/courses/${id}/cancel`, { reason: value });
    ElMessage.success('课程已取消');
    load();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
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
        const { value } = await ElMessageBox.prompt('课程已满，如需破格录取请填写原因（如扩班）：', '破格录取', {
          inputPlaceholder: '原因',
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
    const { value } = await ElMessageBox.prompt(
      `确认 ${row.student_name} 退出「${course.value.title}」？已缴费将自动生成退费申请，空出名额按候补顺序递补。`,
      '学员退课',
      { inputPlaceholder: '退课原因', inputValue: '学员主动退课', inputValidator: (v) => !!v || '请填写原因' }
    );
    await api.post(`/enrollments/${row.id}/cancel`, { reason: value });
    ElMessage.success('已退课');
    load();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

function openEval(row: any) {
  evalRow.value = row;
  evalForm.rating = row.eval_rating || 5;
  evalForm.comment = row.eval_comment || '';
  evalDlg.value = true;
}

async function saveEval() {
  try {
    await api.put(`/enrollments/${evalRow.value.id}/evaluation`, evalForm);
    ElMessage.success('评价已保存');
    evalDlg.value = false;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function saveMaterial() {
  try {
    await api.post('/materials', { ...matForm, course_id: id });
    ElMessage.success('已添加');
    matDlg.value = false;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

function openRestock(row: any) {
  restockRow.value = row;
  restockForm.qty = 10;
  restockForm.reason = '';
  restockDlg.value = true;
}

async function saveRestock() {
  try {
    await api.post(`/materials/${restockRow.value.id}/restock`, restockForm);
    ElMessage.success('已入库');
    restockDlg.value = false;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function showMatLogs(row: any) {
  matLogRow.value = row;
  const { data } = await api.get(`/materials/${row.id}/logs`);
  matLogs.value = data;
  matLogDrawer.value = true;
}

onMounted(() => {
  load();
  loadPrecheck();
});
</script>

<style scoped>
.chk {
  margin-bottom: 10px;
}
</style>
