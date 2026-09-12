<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">学员档案</div>
      <el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="openEdit()">新增学员</el-button>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="学员列表" name="students">
        <div class="filter-bar" style="margin-bottom: 12px">
          <el-input v-model="kw" placeholder="姓名/电话" clearable style="width: 200px" @change="load" />
        </div>
        <el-card shadow="never">
          <el-table :data="rows" size="small" v-loading="loading">
            <el-table-column prop="name" label="姓名" width="90" />
            <el-table-column prop="gender" label="性别" width="60" />
            <el-table-column label="年龄" width="60">
              <template #default="{ row }">{{ 2026 - row.birth_year }}</template>
            </el-table-column>
            <el-table-column prop="phone" label="电话" width="120" />
            <el-table-column prop="emergency_contact" label="紧急联系人" width="160" show-overflow-tooltip />
            <el-table-column prop="health_limits" label="健康限制" width="130" show-overflow-tooltip />
            <el-table-column prop="source" label="来源" width="90" />
            <el-table-column prop="active_courses" label="在读课程" width="80" />
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openProfile(row)">档案</el-button>
                <el-button v-if="auth.canManage" link size="small" @click="openEdit(row)">编辑</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="学习记录" name="records">
        <el-card shadow="never">
          <el-table :data="records" size="small">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="course_title" label="课程" width="150" />
            <el-table-column prop="term" label="期次" width="120" />
            <el-table-column label="出勤率" width="140">
              <template #default="{ row }">
                <div style="display: flex; align-items: center; gap: 6px">
                  <div class="bar-wrap" style="width: 70px">
                    <div
                      class="bar-inner"
                      :style="{ width: row.attendance_rate + '%', background: row.attendance_rate >= 85 ? '#67c23a' : row.attendance_rate >= 60 ? '#e6a23c' : '#f56c6c' }"
                    />
                  </div>
                  <span>{{ row.attendance_rate }}%</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="勤/迟/假/缺" width="110">
              <template #default="{ row }">{{ row.attended }}/{{ row.late }}/{{ row.leaves }}/{{ row.absent }}</template>
            </el-table-column>
            <el-table-column prop="makeup_done" label="补课" width="60" />
            <el-table-column label="教师评价" width="130">
              <template #default="{ row }">
                <el-rate v-if="row.teacher_rating" :model-value="row.teacher_rating" disabled size="small" />
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column prop="refund_total" label="退费(元)" width="80" />
            <el-table-column prop="reenroll_suggestion" label="续报名建议" min-width="200" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增/编辑学员 -->
    <el-dialog v-model="dlg" :title="form.id ? '编辑学员' : '新增学员'" width="500px">
      <el-form label-width="90px">
        <el-form-item label="姓名" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="form.gender">
            <el-radio-button value="女">女</el-radio-button>
            <el-radio-button value="男">男</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="出生年份" required><el-input-number v-model="form.birth_year" :min="1930" :max="1975" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="紧急联系人"><el-input v-model="form.emergency_contact" placeholder="关系+姓名+电话" /></el-form-item>
        <el-form-item label="健康限制"><el-input v-model="form.health_limits" placeholder="如：高血压、膝关节不好" /></el-form-item>
        <el-form-item label="来源">
          <el-select v-model="form.source" style="width: 100%">
            <el-option v-for="s in meta.sources" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 学员档案抽屉 -->
    <el-drawer v-model="profileDrawer" size="560px" :title="profile ? `${profile.student.name} · 学员档案` : ''">
      <template v-if="profile">
        <el-descriptions :column="2" border size="small" style="margin-bottom: 14px">
          <el-descriptions-item label="年龄">{{ 2026 - profile.student.birth_year }}岁</el-descriptions-item>
          <el-descriptions-item label="电话">{{ profile.student.phone }}</el-descriptions-item>
          <el-descriptions-item label="健康限制">{{ profile.student.health_limits || '无' }}</el-descriptions-item>
          <el-descriptions-item label="紧急联系人">{{ profile.student.emergency_contact }}</el-descriptions-item>
        </el-descriptions>
        <h4>报名记录</h4>
        <el-table :data="profile.enrollments" size="small" style="margin-bottom: 14px">
          <el-table-column prop="course_title" label="课程" width="140" />
          <el-table-column prop="term" label="期次" width="110" />
          <el-table-column prop="status" label="状态" width="80">
            <template #default="{ row }"><el-tag size="small">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="fee_status" label="缴费" width="70" />
        </el-table>
        <h4>学习记录</h4>
        <el-table :data="profile.records" size="small">
          <el-table-column prop="course_title" label="课程" width="140" />
          <el-table-column prop="attendance_rate" label="出勤率" width="80">
            <template #default="{ row }">{{ row.attendance_rate }}%</template>
          </el-table-column>
          <el-table-column prop="teacher_comment" label="教师评语" min-width="160" show-overflow-tooltip />
          <el-table-column prop="reenroll_suggestion" label="续报建议" min-width="160" show-overflow-tooltip />
        </el-table>
      </template>
    </el-drawer>
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
const tab = ref('students');
const rows = ref<any[]>([]);
const records = ref<any[]>([]);
const kw = ref('');
const loading = ref(false);
const dlg = ref(false);
const emptyForm = {
  id: 0, name: '', gender: '女', birth_year: 1955, phone: '',
  emergency_contact: '', health_limits: '', source: '现场咨询', note: '',
};
const form = reactive({ ...emptyForm });
const profileDrawer = ref(false);
const profile = ref<any>(null);

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/students', { params: { kw: kw.value } });
    rows.value = data;
  } finally {
    loading.value = false;
  }
}

async function loadRecords() {
  const { data } = await api.get('/analysis/learning-records');
  records.value = data;
}

function openEdit(row?: any) {
  Object.assign(form, emptyForm, row ? { ...row } : {});
  dlg.value = true;
}

async function save() {
  if (!form.name) {
    ElMessage.warning('请填写姓名');
    return;
  }
  try {
    if (form.id) await api.put(`/students/${form.id}`, form);
    else await api.post('/students', form);
    ElMessage.success('已保存');
    dlg.value = false;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function openProfile(row: any) {
  const { data } = await api.get(`/students/${row.id}/profile`);
  profile.value = data;
  profileDrawer.value = true;
}

onMounted(() => {
  meta.load();
  load();
  loadRecords();
});
</script>
