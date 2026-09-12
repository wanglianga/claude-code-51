<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">课次考勤</div>
    </div>

    <div class="filter-bar" style="margin-bottom: 12px">
      <el-select v-model="courseId" placeholder="选择课程（已开班）" style="width: 240px" @change="onCourse">
        <el-option v-for="c in courses" :key="c.id" :label="`${c.title}（${c.term}）`" :value="c.id" />
      </el-select>
      <el-select v-model="sessionId" placeholder="选择课次" style="width: 300px" @change="loadSession">
        <el-option
          v-for="s in sessions"
          :key="s.id"
          :label="`第${s.session_no}次 ${s.session_date?.slice(0, 10)} ${s.start_time}${s.is_makeup_session ? '（补课）' : ''}${s.status === '已停课' ? '（已停课）' : ''}`"
          :value="s.id"
        />
      </el-select>
    </div>

    <template v-if="session">
      <el-card shadow="never" style="margin-bottom: 12px">
        <template #header>
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
            <div>
              <b>{{ session.course_title }} · 第{{ session.session_no }}次课</b>
              <el-tag v-if="session.is_makeup_session" type="warning" size="small" style="margin-left: 6px">补课课次</el-tag>
              <el-tag v-if="session.status === '已停课'" type="danger" size="small" style="margin-left: 6px">已停课</el-tag>
              <div style="font-size: 12px; color: #909399; margin-top: 4px">
                {{ session.session_date?.slice(0, 10) }} {{ session.start_time }}-{{ session.end_time }} ·
                {{ session.room_name }} · {{ session.teacher_name }}
                <span v-if="session.cancel_reason" style="color: #f56c6c"> · {{ session.cancel_reason }}</span>
              </div>
            </div>
            <div v-if="auth.canManage && session.status !== '已停课'">
              <el-button size="small" type="warning" plain @click="cancelDlg = true">停课/换教室</el-button>
              <el-button size="small" type="success" plain @click="consumeMaterials">登记材料消耗</el-button>
            </div>
          </div>
        </template>

        <el-input
          v-model="sessionNote"
          placeholder="课堂备注（课次整体，如：本节课教授楷书基本笔画）"
          size="small"
          style="margin-bottom: 12px"
        />

        <el-table :data="session.attendances" size="small">
          <el-table-column prop="student_name" label="学员" width="100" />
          <el-table-column label="考勤状态" width="330">
            <template #default="{ row }">
              <el-radio-group v-model="row.status" size="small" :disabled="session.status === '已停课'">
                <el-radio-button v-for="s in ['签到', '迟到', '请假', '缺席', '代签异常']" :key="s" :value="s">{{ s }}</el-radio-button>
              </el-radio-group>
              <el-tag v-if="row.is_makeup" type="warning" size="small" style="margin-left: 6px">补课</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="课堂备注">
            <template #default="{ row }">
              <el-input
                v-model="row.note"
                size="small"
                :placeholder="row.status === '代签异常' ? '必填：代签情况说明' : '个人备注'"
                :disabled="session.status === '已停课'"
              />
            </template>
          </el-table-column>
        </el-table>

        <div v-if="session.leaves?.length" style="margin-top: 10px">
          <el-alert type="info" :closable="false">
            <b>本课次请假：</b>
            <span v-for="l in session.leaves" :key="l.id" style="margin-right: 12px">
              {{ l.student_name }}（{{ l.reason_type }}：{{ l.reason }}）{{ l.status }}
            </span>
          </el-alert>
        </div>

        <div style="margin-top: 14px" v-if="session.status !== '已停课'">
          <el-button type="primary" :loading="saving" @click="save">保存考勤</el-button>
          <span style="font-size: 12px; color: #909399; margin-left: 10px">
            到课 {{ presentCount }} 人 · 请假 {{ leaveCount }} 人 · 异常 {{ anomalyCount }} 人
          </span>
        </div>
      </el-card>
    </template>
    <el-empty v-else description="请选择课程与课次" />

    <!-- 停课处理 -->
    <el-dialog v-model="cancelDlg" title="停课处理" width="480px">
      <el-form label-width="90px">
        <el-form-item label="停课类型" required>
          <el-radio-group v-model="cancelForm.reason_type">
            <el-radio-button value="教师停课">教师停课</el-radio-button>
            <el-radio-button value="教室冲突">教室冲突</el-radio-button>
            <el-radio-button value="材料不足">材料不足</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="原因说明" required>
          <el-input v-model="cancelForm.reason" type="textarea" :rows="2" placeholder="如：教师突发疾病 / 教室被占用 / 材料库存不足" />
        </el-form-item>
        <el-form-item label="处理方式" required>
          <el-radio-group v-model="cancelForm.action">
            <el-radio-button value="补课">安排补课</el-radio-button>
            <el-radio-button value="退费">按次退费</el-radio-button>
            <el-radio-button value="换教室">更换教室</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="cancelForm.action === '换教室'" label="新教室" required>
          <el-select v-model="cancelForm.new_room_id" style="width: 100%">
            <el-option v-for="r in meta.rooms" :key="r.id" :label="`${r.name}（容量${r.capacity}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false">
          <template v-if="cancelForm.action === '补课'">将在最后一次课后追加补课课次，全体学员考勤记为「停课」</template>
          <template v-else-if="cancelForm.action === '退费'">按单次课费用为已缴费学员生成退费申请（需财务审核）</template>
          <template v-else>仅调整本课次教室，课程照常进行</template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="cancelDlg = false">取消</el-button>
        <el-button type="danger" @click="doCancel">确认停课处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, errMsg } from '../api';
import { useMetaStore } from '../stores/meta';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const meta = useMetaStore();
const auth = useAuthStore();

const courses = ref<any[]>([]);
const sessions = ref<any[]>([]);
const courseId = ref<number | null>(null);
const sessionId = ref<number | null>(null);
const session = ref<any>(null);
const sessionNote = ref('');
const saving = ref(false);
const cancelDlg = ref(false);
const cancelForm = reactive({ reason_type: '教师停课', reason: '', action: '补课', new_room_id: null as number | null });

const presentCount = computed(
  () => (session.value?.attendances || []).filter((a: any) => ['签到', '迟到'].includes(a.status)).length
);
const leaveCount = computed(() => (session.value?.attendances || []).filter((a: any) => a.status === '请假').length);
const anomalyCount = computed(
  () => (session.value?.attendances || []).filter((a: any) => ['缺席', '代签异常'].includes(a.status)).length
);

async function loadCourses() {
  const { data } = await api.get('/courses', { params: { status: '已开班' } });
  courses.value = data;
}

async function onCourse() {
  sessionId.value = null;
  session.value = null;
  const { data } = await api.get(`/courses/${courseId.value}/sessions`);
  sessions.value = data;
}

async function loadSession() {
  if (!sessionId.value) return;
  const { data } = await api.get(`/sessions/${sessionId.value}`);
  session.value = data;
  sessionNote.value = data.note || '';
  // 默认未签到
  for (const a of session.value.attendances) {
    if (!a.status) a.status = '未签到';
  }
}

async function save() {
  const anomaly = session.value.attendances.find((a: any) => a.status === '代签异常' && !a.note);
  if (anomaly) {
    ElMessage.warning(`「${anomaly.student_name}」标记为代签异常，必须填写备注说明`);
    return;
  }
  saving.value = true;
  try {
    await api.put(`/sessions/${sessionId.value}/attendance`, {
      session_note: sessionNote.value,
      records: session.value.attendances.map((a: any) => ({
        enrollment_id: a.enrollment_id,
        status: a.status,
        note: a.note || '',
      })),
    });
    ElMessage.success('考勤已保存');
    loadSession();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}

async function doCancel() {
  if (!cancelForm.reason) {
    ElMessage.warning('请填写停课原因');
    return;
  }
  try {
    await api.post(`/sessions/${sessionId.value}/cancel`, cancelForm);
    ElMessage.success('停课处理完成');
    cancelDlg.value = false;
    Object.assign(cancelForm, { reason_type: '教师停课', reason: '', action: '补课', new_room_id: null });
    loadSession();
    onCourse();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function consumeMaterials() {
  try {
    await ElMessageBox.confirm(`将按当前到课 ${presentCount.value} 人扣减本课程材料库存，是否继续？`, '登记材料消耗', {
      type: 'warning',
    });
    const { data } = await api.post(`/sessions/${sessionId.value}/consume-materials`);
    if (data.shortages?.length) {
      ElMessage.warning(`部分材料不足：${data.shortages.join('；')}`);
    } else {
      ElMessage.success('材料消耗已登记');
    }
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

onMounted(async () => {
  meta.load();
  await loadCourses();
  const qSession = Number(route.query.session);
  if (qSession) {
    // 从课次反查课程
    const { data } = await api.get(`/sessions/${qSession}`);
    courseId.value = data.course_id;
    await onCourse();
    sessionId.value = qSession;
    await loadSession();
  }
});
</script>
