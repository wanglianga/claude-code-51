<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">课程管理</div>
      <el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="openEdit()">新建课程</el-button>
    </div>

    <div class="filter-bar" style="margin-bottom: 12px">
      <el-select v-model="filters.term" placeholder="期次" clearable style="width: 160px" @change="load">
        <el-option v-for="t in meta.terms" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="filters.category" placeholder="类别" clearable style="width: 130px" @change="load">
        <el-option v-for="c in meta.categories" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px" @change="load">
        <el-option v-for="s in meta.courseStatuses" :key="s" :label="s" :value="s" />
      </el-select>
    </div>

    <el-card shadow="never">
      <el-table :data="rows" v-loading="loading" @row-click="(r: any) => $router.push(`/courses/${r.id}`)" style="cursor: pointer">
        <el-table-column prop="title" label="课程" width="150" fixed />
        <el-table-column prop="category" label="类别" width="90">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.category }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="term" label="期次" width="130" />
        <el-table-column prop="teacher_name" label="教师" width="90" />
        <el-table-column prop="room_name" label="教室" width="90" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">周{{ weekdays[row.weekday - 1] }} {{ row.start_time }}-{{ row.end_time }}</template>
        </el-table-column>
        <el-table-column label="名额" width="110">
          <template #default="{ row }">
            <span :style="{ color: row.confirmed_count >= row.capacity ? '#f56c6c' : '#67c23a' }">
              {{ row.confirmed_count }}/{{ row.capacity }}
            </span>
            <el-tag v-if="row.waitlist_count" type="warning" size="small" style="margin-left: 4px">
              候补{{ row.waitlist_count }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="fee" label="费用(元)" width="90" />
        <el-table-column prop="total_sessions" label="课次" width="70" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="$router.push(`/courses/${row.id}`)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑课程 -->
    <el-dialog v-model="dlg" :title="form.id ? '编辑课程' : '新建课程'" width="560px">
      <el-form label-width="90px">
        <el-form-item label="课程名称" required><el-input v-model="form.title" placeholder="如：书法基础班" /></el-form-item>
        <el-form-item label="类别" required>
          <el-select v-model="form.category" style="width: 100%">
            <el-option v-for="c in meta.categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="期次" required><el-input v-model="form.term" placeholder="如：2026年秋季二期" /></el-form-item>
        <el-form-item label="教师">
          <el-select v-model="form.teacher_id" style="width: 100%" clearable>
            <el-option v-for="t in meta.teachers" :key="t.id" :label="`${t.name}（${t.specialty}）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="教室">
          <el-select v-model="form.room_id" style="width: 100%" clearable>
            <el-option v-for="r in meta.rooms" :key="r.id" :label="`${r.name}（容量${r.capacity}）`" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="开课日期" required>
          <el-date-picker v-model="form.start_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="上课时间">
          <el-time-select v-model="form.start_time" start="07:00" step="00:30" end="20:00" style="width: 48%" />
          <el-time-select v-model="form.end_time" start="07:30" step="00:30" end="21:00" style="width: 48%; margin-left: 4%" />
        </el-form-item>
        <el-form-item label="课次/容量">
          <el-input-number v-model="form.total_sessions" :min="1" :max="40" style="width: 48%" />
          <el-input-number v-model="form.capacity" :min="1" :max="200" style="width: 48%; margin-left: 4%" />
        </el-form-item>
        <el-form-item label="费用(元)"><el-input-number v-model="form.fee" :min="0" :max="9999" style="width: 48%" /></el-form-item>
        <el-form-item label="材料需求"><el-input v-model="form.material_note" placeholder="如：宣纸、墨汁（社区统一采购）" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { api, errMsg } from '../api';
import { useMetaStore } from '../stores/meta';
import { useAuthStore } from '../stores/auth';

const meta = useMetaStore();
const auth = useAuthStore();
const rows = ref<any[]>([]);
const loading = ref(false);
const dlg = ref(false);
const saving = ref(false);
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const filters = reactive({ term: '', category: '', status: '' });
const emptyForm = {
  id: 0, title: '', category: '', term: '', teacher_id: null as number | null,
  room_id: null as number | null, start_date: '', start_time: '09:00', end_time: '10:30',
  total_sessions: 10, capacity: 20, fee: 0, material_note: '',
};
const form = reactive({ ...emptyForm });

function statusType(s: string) {
  return { 报名中: 'warning', 已开班: 'success', 已结课: 'info', 已取消: 'danger' }[s] as any;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/courses', { params: filters });
    rows.value = data;
  } finally {
    loading.value = false;
  }
}

function openEdit(row?: any) {
  Object.assign(form, emptyForm, row ? { ...row } : {});
  dlg.value = true;
}

async function save() {
  if (!form.title || !form.category || !form.term || !form.start_date) {
    ElMessage.warning('请填写课程名称、类别、期次、开课日期');
    return;
  }
  saving.value = true;
  try {
    if (form.id) await api.put(`/courses/${form.id}`, form);
    else await api.post('/courses', form);
    ElMessage.success('已保存');
    dlg.value = false;
    meta.load(true);
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  meta.load();
  load();
});
</script>
