<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">展演活动（作品展示 / 汇报演出）</div>
      <el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="openEdit()">新建活动</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="rows" size="small" v-loading="loading">
        <el-table-column prop="title" label="活动名称" min-width="150" />
        <el-table-column prop="event_type" label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="row.event_type === '汇报演出' ? 'danger' : 'primary'" size="small" effect="plain">{{ row.event_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="course_title" label="所属课程" width="130" />
        <el-table-column label="日期" width="105">
          <template #default="{ row }">{{ row.event_date?.slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column prop="room_name" label="场地" width="90" />
        <el-table-column prop="participant_count" label="参演" width="60" />
        <el-table-column prop="rehearsal_count" label="排练" width="60" />
        <el-table-column prop="family_observers" label="家属观摩" width="80" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="({ 筹备中: 'warning', 已举办: 'success', 已归档: 'info' } as Record<string, string>)[row.status] as any" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="auth.canManage" link size="small" @click="openEdit(row)">编辑</el-button>
            <template v-if="auth.canManage">
              <el-button v-if="row.status === '筹备中'" link type="success" size="small" @click="markHeld(row)">举办</el-button>
              <el-button v-if="row.status === '已举办'" link type="warning" size="small" @click="archive(row)">归档</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑活动 -->
    <el-dialog v-model="dlg" :title="form.id ? '编辑活动' : '新建展演活动'" width="560px">
      <el-form label-width="90px">
        <el-form-item label="所属课程" required>
          <el-select v-model="form.course_id" style="width: 100%" :disabled="!!form.id">
            <el-option v-for="c in courses" :key="c.id" :label="`${c.title}（${c.term}）`" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="活动名称" required><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.event_type">
            <el-radio-button v-for="t in meta.eventTypes" :key="t" :value="t">{{ t }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="日期" required>
          <el-date-picker v-model="form.event_date" type="date" value-format="YYYY-MM-DD" style="width: 48%" />
        </el-form-item>
        <el-form-item label="场地">
          <el-select v-model="form.room_id" style="width: 100%" clearable>
            <el-option v-for="r in meta.rooms" :key="r.id" :label="`${r.name}（容量${r.capacity}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="排练次数"><el-input-number v-model="form.rehearsal_count" :min="0" :max="20" /></el-form-item>
        <el-form-item label="服装要求"><el-input v-model="form.costume_notes" placeholder="如：统一红色围巾与白色上衣" /></el-form-item>
        <el-form-item label="家属观摩"><el-input-number v-model="form.family_observers" :min="0" :max="200" /> 人</el-form-item>
        <el-form-item label="安全预案">
          <el-input v-model="form.safety_plan" type="textarea" :rows="3" placeholder="现场秩序、安全出口、急救保障、用电检查等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 活动详情（参演名单 + 档案信息） -->
    <el-drawer v-model="detailDrawer" size="520px" :title="detail?.title || ''">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small" style="margin-bottom: 14px">
          <el-descriptions-item label="类型">{{ detail.event_type }}</el-descriptions-item>
          <el-descriptions-item label="课程">{{ detail.course_title }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ detail.event_date?.slice(0, 10) }}</el-descriptions-item>
          <el-descriptions-item label="场地">{{ detail.room_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="排练次数">{{ detail.rehearsal_count }}</el-descriptions-item>
          <el-descriptions-item label="家属观摩">{{ detail.family_observers }}人</el-descriptions-item>
          <el-descriptions-item label="服装" :span="2">{{ detail.costume_notes || '-' }}</el-descriptions-item>
          <el-descriptions-item label="安全预案" :span="2">{{ detail.safety_plan || '-' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.archive_note" label="归档小结" :span="2">{{ detail.archive_note }}</el-descriptions-item>
        </el-descriptions>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
          <h4 style="margin: 0">参演名单（{{ participants.length }}）</h4>
          <el-button v-if="auth.canManage" size="small" type="primary" plain @click="openAddParticipants">添加学员</el-button>
        </div>
        <el-table :data="participants" size="small">
          <el-table-column prop="student_name" label="学员" width="110" />
          <el-table-column prop="level" label="基础水平" width="90" />
          <el-table-column prop="role" label="角色" width="80" />
          <el-table-column label="操作">
            <template #default="{ row }">
              <el-button v-if="auth.canManage" link type="danger" size="small" @click="removeParticipant(row)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>

    <!-- 添加参演 -->
    <el-dialog v-model="addDlg" title="添加参演学员" width="480px">
      <el-select v-model="addIds" multiple filterable style="width: 100%" placeholder="从课程已录取学员中选择">
        <el-option v-for="e in courseEnrollments" :key="e.id" :label="e.student_name" :value="e.id" />
      </el-select>
      <template #footer>
        <el-button @click="addDlg = false">取消</el-button>
        <el-button type="primary" @click="saveParticipants">添加</el-button>
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
const rows = ref<any[]>([]);
const courses = ref<any[]>([]);
const loading = ref(false);
const dlg = ref(false);
const emptyForm = {
  id: 0, course_id: null as number | null, title: '', event_type: '汇报演出',
  event_date: '', room_id: null as number | null, rehearsal_count: 0,
  costume_notes: '', family_observers: 0, safety_plan: '',
};
const form = reactive({ ...emptyForm });
const detailDrawer = ref(false);
const detail = ref<any>(null);
const participants = ref<any[]>([]);
const addDlg = ref(false);
const addIds = ref<number[]>([]);
const courseEnrollments = ref<any[]>([]);

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/events');
    rows.value = data;
  } finally {
    loading.value = false;
  }
}

function openEdit(row?: any) {
  Object.assign(form, emptyForm, row ? { ...row, event_date: row.event_date?.slice(0, 10) } : {});
  dlg.value = true;
}

async function save() {
  if (!form.course_id || !form.title || !form.event_date) {
    ElMessage.warning('请填写课程、名称、日期');
    return;
  }
  try {
    if (form.id) await api.put(`/events/${form.id}`, form);
    else await api.post('/events', form);
    ElMessage.success('已保存');
    dlg.value = false;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function openDetail(row: any) {
  detail.value = row;
  const { data } = await api.get(`/events/${row.id}/participants`);
  participants.value = data;
  detailDrawer.value = true;
}

async function openAddParticipants() {
  const { data } = await api.get(`/courses/${detail.value.course_id}/enrollments`);
  const existing = new Set(participants.value.map((p) => p.enrollment_id));
  courseEnrollments.value = data.filter((e: any) => e.status === '已录取' && !existing.has(e.id));
  addIds.value = [];
  addDlg.value = true;
}

async function saveParticipants() {
  if (!addIds.value.length) {
    ElMessage.warning('请选择学员');
    return;
  }
  try {
    await api.post(`/events/${detail.value.id}/participants`, { enrollment_ids: addIds.value });
    ElMessage.success('已添加');
    addDlg.value = false;
    openDetail(detail.value);
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function removeParticipant(row: any) {
  await api.delete(`/events/${detail.value.id}/participants/${row.id}`);
  openDetail(detail.value);
  load();
}

async function markHeld(row: any) {
  try {
    await ElMessageBox.confirm(`确认「${row.title}」已举办？`, '活动举办', { type: 'warning' });
    await api.post(`/events/${row.id}/status`, { status: '已举办' });
    ElMessage.success('已标记为已举办');
    load();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function archive(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('归档小结将进入课程档案，请填写：', '活动归档', {
      inputPlaceholder: '如：演出顺利，45名家属到场观摩，无安全事故',
      inputValidator: (v) => !!v || '请填写归档小结',
    });
    await api.post(`/events/${row.id}/status`, { status: '已归档', archive_note: value });
    ElMessage.success('已归档');
    load();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

onMounted(async () => {
  meta.load();
  load();
  const { data } = await api.get('/courses');
  courses.value = data;
});
</script>
