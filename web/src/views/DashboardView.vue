<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">工作台</div>
      <el-button :icon="Refresh" circle @click="load" />
    </div>

    <el-row :gutter="14">
      <el-col v-for="c in cards" :key="c.label" :xs="12" :sm="8" :md="4">
        <div class="stat-card" :style="{ background: c.color }">
          <div>{{ c.label }}</div>
          <div class="num">{{ c.value }}</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="14" style="margin-top: 14px">
      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header><b>⚠️ 材料库存预警</b></template>
          <el-table :data="overview.materialWarnings || []" size="small" v-if="(overview.materialWarnings || []).length">
            <el-table-column prop="course_title" label="课程" width="130" />
            <el-table-column prop="name" label="材料" width="90" />
            <el-table-column label="库存/每次课需求">
              <template #default="{ row }">
                <span style="color: #f56c6c">{{ row.stock_qty }}{{ row.unit }}</span>
                / {{ row.need }}{{ row.unit }}
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无材料预警" :image-size="60" />
        </el-card>
      </el-col>
      <el-col :xs="24" :md="7">
        <el-card shadow="never">
          <template #header><b>📌 候补压力</b></template>
          <el-table :data="waitlist" size="small">
            <el-table-column prop="title" label="课程" width="120" />
            <el-table-column label="候补" width="70">
              <template #default="{ row }">
                <el-tag :type="row.waitlist > 0 ? 'warning' : 'info'" size="small">{{ row.waitlist }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="verdict" label="判断" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="7">
        <el-card shadow="never">
          <template #header><b>🕒 最新动态</b></template>
          <el-timeline style="padding-left: 4px">
            <el-timeline-item
              v-for="a in overview.recentAudits || []"
              :key="a.id"
              :timestamp="fmtTime(a.created_at)"
              size="small"
            >
              <b>{{ a.actor }}</b> {{ a.action }}
              <div v-if="a.reason" class="reason">{{ a.reason }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api } from '../api';

const overview = ref<any>({});
const waitlist = ref<any[]>([]);

const cards = computed(() => [
  { label: '在册学员', value: overview.value.students ?? '-', color: '#409eff' },
  { label: '进行中课程', value: overview.value.activeCourses ?? '-', color: '#67c23a' },
  { label: '待审批请假', value: overview.value.pendingLeaves ?? '-', color: '#e6a23c' },
  { label: '待审核退费', value: overview.value.pendingRefunds ?? '-', color: '#f56c6c' },
  { label: '待安排补课', value: overview.value.pendingMakeups ?? '-', color: '#909399' },
  { label: '候补总人数', value: overview.value.waitlistTotal ?? '-', color: '#b88230' },
]);

function fmtTime(t: string) {
  return t ? t.replace('T', ' ').slice(5, 16) : '';
}

async function load() {
  const [o, w] = await Promise.all([api.get('/analysis/overview'), api.get('/analysis/waitlist')]);
  overview.value = o.data;
  waitlist.value = w.data.filter((r: any) => r.waitlist > 0);
}

onMounted(load);
</script>

<style scoped>
.reason {
  color: #909399;
  font-size: 12px;
}
</style>
