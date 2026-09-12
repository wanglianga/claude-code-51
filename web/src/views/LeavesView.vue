<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">请假与补课</div>
      <el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="openNew">登记请假</el-button>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="请假申请" name="leaves">
        <el-card shadow="never">
          <div class="filter-bar" style="margin-bottom: 10px">
            <el-radio-group v-model="leaveStatus" size="small" @change="loadLeaves">
              <el-radio-button value="">全部</el-radio-button>
              <el-radio-button value="待审批">待审批</el-radio-button>
              <el-radio-button value="已批准">已批准</el-radio-button>
              <el-radio-button value="已拒绝">已拒绝</el-radio-button>
            </el-radio-group>
          </div>
          <el-table :data="leaves" size="small" v-loading="loading">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="course_title" label="课程" width="130" />
            <el-table-column label="课次" width="150">
              <template #default="{ row }">第{{ row.session_no }}次（{{ row.session_date?.slice(0, 10) }}）</template>
            </el-table-column>
            <el-table-column prop="reason_type" label="类型" width="80">
              <template #default="{ row }">
                <el-tag :type="row.reason_type === '病假' ? 'danger' : 'warning'" size="small">{{ row.reason_type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="({ 待审批: 'warning', 已批准: 'success', 已拒绝: 'info' } as Record<string, string>)[row.status] as any" size="small">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="handled_by" label="处理人" width="110">
              <template #default="{ row }">{{ row.handled_by || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <template v-if="row.status === '待审批' && auth.canManage">
                  <el-button link type="success" size="small" @click="approve(row)">批准</el-button>
                  <el-button link type="danger" size="small" @click="reject(row)">拒绝</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="补课安排" name="makeups">
        <el-card shadow="never">
          <div class="filter-bar" style="margin-bottom: 10px">
            <el-radio-group v-model="makeupStatus" size="small" @change="loadMakeups">
              <el-radio-button value="">全部</el-radio-button>
              <el-radio-button value="待安排">待安排</el-radio-button>
              <el-radio-button value="已安排">已安排</el-radio-button>
              <el-radio-button value="已完成">已完成</el-radio-button>
              <el-radio-button value="已失效">已失效</el-radio-button>
            </el-radio-group>
          </div>
          <el-table :data="makeups" size="small">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="course_title" label="课程" width="130" />
            <el-table-column label="缺勤课次" width="150">
              <template #default="{ row }">第{{ row.original_no }}次（{{ row.original_date?.slice(0, 10) }}）</template>
            </el-table-column>
            <el-table-column label="补课课次" width="170">
              <template #default="{ row }">
                <span v-if="row.makeup_no">第{{ row.makeup_no }}次（{{ row.makeup_date?.slice(0, 10) }}）</span>
                <span v-else style="color: #c0c4cc">未安排</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="({ 待安排: 'warning', 已安排: 'primary', 已完成: 'success', 已失效: 'info' } as Record<string, string>)[row.status] as any" size="small">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <template v-if="auth.canManage">
                  <el-button v-if="row.status === '待安排'" link type="primary" size="small" @click="openArrange(row)">安排补课</el-button>
                  <el-button v-if="['待安排', '已安排'].includes(row.status)" link type="danger" size="small" @click="voidMakeup(row)">作废</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 登记请假 -->
    <el-dialog v-model="newDlg" title="登记请假" width="500px">
      <el-form label-width="90px">
        <el-form-item label="学员" required>
          <el-select v-model="leaveForm.enrollment_id" filterable style="width: 100%" placeholder="选择学员（按课程）" @change="onEnrollment">
            <el-option
              v-for="e in activeEnrollments"
              :key="e.id"
              :label="`${e.student_name} · ${e.course_title}`"
              :value="e.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="请假课次" required>
          <el-select v-model="leaveForm.session_id" style="width: 100%" :disabled="!leaveSessions.length">
            <el-option
              v-for="s in leaveSessions"
              :key="s.id"
              :label="`第${s.session_no}次 ${s.session_date?.slice(0, 10)} ${s.start_time}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="请假类型" required>
          <el-radio-group v-model="leaveForm.reason_type">
            <el-radio-button v-for="t in meta.leaveReasonTypes" :key="t" :value="t">{{ t }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="原因说明">
          <el-input v-model="leaveForm.reason" type="textarea" :rows="2" placeholder="如：感冒发烧，社区医院开具病假条" />
        </el-form-item>
        <el-alert type="info" :closable="false" title="批准后将自动记考勤为「请假」并生成补课安排" />
      </el-form>
      <template #footer>
        <el-button @click="newDlg = false">取消</el-button>
        <el-button type="primary" @click="saveLeave">提交</el-button>
      </template>
    </el-dialog>

    <!-- 安排补课 -->
    <el-dialog v-model="arrangeDlg" title="安排补课" width="480px">
      <el-form label-width="90px">
        <el-form-item label="学员">{{ arrangeRow?.student_name }}</el-form-item>
        <el-form-item label="缺勤课次">第{{ arrangeRow?.original_no }}次（{{ arrangeRow?.original_date?.slice(0, 10) }}）</el-form-item>
        <el-form-item label="补课课次" required>
          <el-select v-model="arrangeSessionId" style="width: 100%">
            <el-option
              v-for="s in arrangeSessions"
              :key="s.id"
              :label="`第${s.session_no}次 ${s.session_date?.slice(0, 10)} ${s.start_time}${s.is_makeup_session ? '（补课）' : ''}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false" title="补课后学员在该课次签到，补课自动记为完成" />
      </el-form>
      <template #footer>
        <el-button @click="arrangeDlg = false">取消</el-button>
        <el-button type="primary" @click="saveArrange">确认安排</el-button>
      </template>
    </el-dialog>
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
const tab = ref('leaves');
const leaves = ref<any[]>([]);
const makeups = ref<any[]>([]);
const loading = ref(false);
const leaveStatus = ref('');
const makeupStatus = ref('');

const newDlg = ref(false);
const activeEnrollments = ref<any[]>([]);
const leaveSessions = ref<any[]>([]);
const leaveForm = reactive({ enrollment_id: null as number | null, session_id: null as number | null, reason_type: '病假', reason: '' });

const arrangeDlg = ref(false);
const arrangeRow = ref<any>(null);
const arrangeSessions = ref<any[]>([]);
const arrangeSessionId = ref<number | null>(null);

async function loadLeaves() {
  loading.value = true;
  try {
    const { data } = await api.get('/leave-requests', { params: { status: leaveStatus.value } });
    leaves.value = data;
  } finally {
    loading.value = false;
  }
}

async function loadMakeups() {
  const { data } = await api.get('/makeups', { params: { status: makeupStatus.value } });
  makeups.value = data;
}

async function openNew() {
  const { data } = await api.get('/enrollments', { params: { status: '已录取' } });
  activeEnrollments.value = data;
  Object.assign(leaveForm, { enrollment_id: null, session_id: null, reason_type: '病假', reason: '' });
  leaveSessions.value = [];
  newDlg.value = true;
}

async function onEnrollment(eid: number) {
  leaveForm.session_id = null;
  const en = activeEnrollments.value.find((e) => e.id === eid);
  if (!en) return;
  const { data } = await api.get(`/courses/${en.course_id}/sessions`);
  // 仅可选择未停课课次
  leaveSessions.value = data.filter((s: any) => s.status !== '已停课');
}

async function saveLeave() {
  if (!leaveForm.enrollment_id || !leaveForm.session_id) {
    ElMessage.warning('请选择学员与课次');
    return;
  }
  try {
    await api.post('/leave-requests', leaveForm);
    ElMessage.success('请假已登记，待审批');
    newDlg.value = false;
    loadLeaves();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function approve(row: any) {
  try {
    await ElMessageBox.confirm(
      `批准 ${row.student_name} 的${row.reason_type}？将自动记考勤为「请假」并生成补课安排。`,
      '批准请假',
      { type: 'warning' }
    );
    await api.post(`/leave-requests/${row.id}/approve`);
    ElMessage.success('已批准，补课单已生成');
    loadLeaves();
    loadMakeups();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function reject(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('请填写拒绝原因：', '拒绝请假', {
      inputPlaceholder: '原因',
      inputValidator: (v) => !!v || '请填写原因',
    });
    await api.post(`/leave-requests/${row.id}/reject`, { note: value });
    ElMessage.success('已拒绝');
    loadLeaves();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function openArrange(row: any) {
  arrangeRow.value = row;
  const { data } = await api.get(`/courses/${row.course_id}/sessions`);
  const today = new Date().toISOString().slice(0, 10);
  arrangeSessions.value = data.filter(
    (s: any) => s.status !== '已停课' && s.session_date?.slice(0, 10) >= today && s.id !== row.original_session_id
  );
  arrangeSessionId.value = null;
  arrangeDlg.value = true;
}

async function saveArrange() {
  if (!arrangeSessionId.value) {
    ElMessage.warning('请选择补课课次');
    return;
  }
  try {
    await api.post(`/makeups/${arrangeRow.value.id}/arrange`, { makeup_session_id: arrangeSessionId.value });
    ElMessage.success('补课已安排');
    arrangeDlg.value = false;
    loadMakeups();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function voidMakeup(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('作废补课（如学员选择退费），请填写原因：', '补课作废', {
      inputPlaceholder: '原因',
      inputValidator: (v) => !!v || '请填写原因',
    });
    await api.post(`/makeups/${row.id}/void`, { reason: value });
    ElMessage.success('已作废');
    loadMakeups();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

onMounted(() => {
  meta.load();
  loadLeaves();
  loadMakeups();
});
</script>
