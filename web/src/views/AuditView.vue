<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">流水档案（请假 / 停课 / 转班 / 材料消耗 / 退费 全程溯源）</div>
    </div>

    <div class="filter-bar" style="margin-bottom: 12px">
      <el-select v-model="filters.entity_type" placeholder="业务类型" clearable style="width: 150px" @change="load">
        <el-option v-for="t in entityTypes" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <el-select v-model="filters.course_id" placeholder="课程" clearable style="width: 180px" @change="load">
        <el-option v-for="c in courses" :key="c.id" :label="c.title" :value="c.id" />
      </el-select>
      <el-input v-model="filters.kw" placeholder="关键词（动作/原因）" clearable style="width: 200px" @change="load" />
      <el-button :icon="Search" @click="load">查询</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="rows" size="small" v-loading="loading">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ row.created_at?.replace('T', ' ').slice(0, 16) }}</template>
        </el-table-column>
        <el-table-column prop="entity_type" label="业务" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ entityName(row.entity_type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="action" label="动作" width="150" />
        <el-table-column prop="reason" label="原因/说明" min-width="280" show-overflow-tooltip />
        <el-table-column prop="student_name" label="学员" width="90">
          <template #default="{ row }">{{ row.student_name || '-' }}</template>
        </el-table-column>
        <el-table-column prop="course_title" label="课程" width="130">
          <template #default="{ row }">{{ row.course_title || '-' }}</template>
        </el-table-column>
        <el-table-column prop="actor" label="经办人" width="140" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { api } from '../api';

const rows = ref<any[]>([]);
const courses = ref<any[]>([]);
const loading = ref(false);
const filters = reactive({ entity_type: '', course_id: null as number | null, kw: '' });

const entityTypes = [
  { label: '报名', value: 'enrollment' },
  { label: '请假', value: 'leave' },
  { label: '补课', value: 'makeup' },
  { label: '退费', value: 'refund' },
  { label: '转班', value: 'transfer' },
  { label: '课次', value: 'session' },
  { label: '材料', value: 'material' },
  { label: '课程', value: 'course' },
  { label: '展演', value: 'event' },
  { label: '规划', value: 'term_plan' },
];

function entityName(t: string) {
  return entityTypes.find((x) => x.value === t)?.label || t;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/analysis/audit-logs', { params: filters });
    rows.value = data;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  load();
  const { data } = await api.get('/courses');
  courses.value = data;
});
</script>
