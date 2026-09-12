<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">活动室资源与下期规划</div>
    </div>

    <el-tabs v-model="tab">
      <!-- 活动室利用分析 -->
      <el-tab-pane label="活动室利用分析" name="rooms">
        <el-card shadow="never">
          <el-alert type="info" :closable="false" style="margin-bottom: 12px"
            title="统计近4周至未来4周各活动室占用情况，判断老年大学课程（含排练/展演）是否挤占社区其他服务时段" />
          <el-table :data="rooms" size="small">
            <el-table-column prop="name" label="活动室" width="100" />
            <el-table-column prop="room_type" label="类型" width="90" />
            <el-table-column prop="capacity" label="容量" width="60" />
            <el-table-column label="课程占用(小时)" width="120">
              <template #default="{ row }">
                <span style="color: #409eff">{{ row.course_hours }}h</span>
                <span style="color: #909399; font-size: 12px">（{{ row.course_bookings }}次）</span>
              </template>
            </el-table-column>
            <el-table-column label="社区服务(小时)" width="120">
              <template #default="{ row }">
                <span style="color: #67c23a">{{ row.community_hours }}h</span>
                <span style="color: #909399; font-size: 12px">（{{ row.community_bookings }}次）</span>
              </template>
            </el-table-column>
            <el-table-column label="课程占用比" width="200">
              <template #default="{ row }">
                <div style="display: flex; align-items: center; gap: 8px">
                  <div class="bar-wrap" style="flex: 1">
                    <div
                      class="bar-inner"
                      :style="{
                        width: row.course_ratio + '%',
                        background: row.course_ratio >= 70 ? '#f56c6c' : row.course_ratio >= 50 ? '#e6a23c' : '#67c23a',
                      }"
                    />
                  </div>
                  <span>{{ row.course_ratio }}%</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="verdict" label="挤占判断" min-width="220">
              <template #default="{ row }">
                <el-tag
                  :type="row.verdict === '正常' ? 'success' : row.verdict.includes('明显') ? 'danger' : 'warning'"
                  size="small"
                >
                  {{ row.verdict }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 候补需求分析 -->
      <el-tab-pane label="候补需求分析" name="waitlist">
        <el-card shadow="never">
          <el-alert type="info" :closable="false" style="margin-bottom: 12px"
            title="候补缴费率是判断候补是否反映真实需求的关键指标：已缴费的候补学员更可能真实入学" />
          <el-table :data="waitlist" size="small">
            <el-table-column prop="title" label="课程" width="150" />
            <el-table-column prop="category" label="类别" width="90" />
            <el-table-column prop="term" label="期次" width="130" />
            <el-table-column label="录取/容量" width="100">
              <template #default="{ row }">{{ row.confirmed }}/{{ row.capacity }}</template>
            </el-table-column>
            <el-table-column prop="waitlist" label="候补人数" width="80" />
            <el-table-column label="候补缴费" width="100">
              <template #default="{ row }">
                {{ row.waitlist_paid }}/{{ row.waitlist }}
                <span style="color: #909399">({{ row.paid_ratio }}%)</span>
              </template>
            </el-table-column>
            <el-table-column label="候补压力" width="160">
              <template #default="{ row }">
                <div style="display: flex; align-items: center; gap: 8px">
                  <div class="bar-wrap" style="flex: 1">
                    <div
                      class="bar-inner"
                      :style="{
                        width: Math.min(row.pressure * 100, 100) + '%',
                        background: row.pressure >= 0.5 ? '#f56c6c' : row.pressure >= 0.2 ? '#e6a23c' : '#67c23a',
                      }"
                    />
                  </div>
                  <span>{{ Math.round(row.pressure * 100) }}%</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="verdict" label="需求判断" min-width="220" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 下期规划 -->
      <el-tab-pane label="下期课程规划" name="plans">
        <el-card shadow="never" style="margin-bottom: 12px">
          <template #header><b>系统建议（基于本期候补压力）</b></template>
          <el-table :data="nextTerm" size="small">
            <el-table-column prop="category" label="类别" width="110" />
            <el-table-column prop="classes" label="本期班数" width="80" />
            <el-table-column prop="capacity" label="总容量" width="80" />
            <el-table-column prop="waitlist" label="候补人数" width="80" />
            <el-table-column prop="waitlist_paid" label="候补已缴费" width="90" />
            <el-table-column label="候补压力" width="90">
              <template #default="{ row }">{{ Math.round(row.pressure * 100) }}%</template>
            </el-table-column>
            <el-table-column prop="suggested_classes" label="建议班数" width="80" />
            <el-table-column prop="suggestion" label="建议说明" min-width="240" />
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button v-if="auth.canManage" size="small" type="primary" plain @click="adopt(row)">采纳建议</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <b>社区规划决策</b>
            <el-button v-if="auth.canManage" size="small" type="primary" style="margin-left: 10px" @click="planDlg = true">
              新增规划
            </el-button>
          </template>
          <el-table :data="plans" size="small">
            <el-table-column prop="term" label="期次" width="140" />
            <el-table-column prop="category" label="类别" width="100" />
            <el-table-column prop="current_classes" label="本期班数" width="80" />
            <el-table-column prop="planned_classes" label="计划班数" width="80" />
            <el-table-column label="候补压力" width="90">
              <template #default="{ row }">{{ Math.round((row.waitlist_pressure || 0) * 100) }}%</template>
            </el-table-column>
            <el-table-column prop="decision_note" label="决策说明" min-width="260" show-overflow-tooltip />
            <el-table-column prop="created_by" label="决策人" width="140" />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增规划 -->
    <el-dialog v-model="planDlg" title="新增下期规划" width="480px">
      <el-form label-width="90px">
        <el-form-item label="期次" required><el-input v-model="planForm.term" placeholder="如：2026年秋季二期" /></el-form-item>
        <el-form-item label="类别" required>
          <el-select v-model="planForm.category" style="width: 100%">
            <el-option v-for="c in meta.categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="本期班数"><el-input-number v-model="planForm.current_classes" :min="0" :max="20" /></el-form-item>
        <el-form-item label="计划班数" required><el-input-number v-model="planForm.planned_classes" :min="1" :max="20" /></el-form-item>
        <el-form-item label="候补压力"><el-input-number v-model="planForm.waitlist_pressure" :min="0" :max="5" :step="0.05" /></el-form-item>
        <el-form-item label="决策说明">
          <el-input v-model="planForm.decision_note" type="textarea" :rows="2" placeholder="如：候补4人且3人已缴费，需求真实，扩1个班" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="planDlg = false">取消</el-button>
        <el-button type="primary" @click="savePlan">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api, errMsg } from '../api';
import { useMetaStore } from '../stores/meta';
import { useAuthStore } from '../stores/auth';

const meta = useMetaStore();
const auth = useAuthStore();
const tab = ref('rooms');
const rooms = ref<any[]>([]);
const waitlist = ref<any[]>([]);
const nextTerm = ref<any[]>([]);
const plans = ref<any[]>([]);
const planDlg = ref(false);
const planForm = reactive({
  term: '2026年秋季二期',
  category: '',
  current_classes: 1,
  planned_classes: 1,
  waitlist_pressure: 0,
  decision_note: '',
});

async function load() {
  const [r, w, n, p] = await Promise.all([
    api.get('/analysis/rooms'),
    api.get('/analysis/waitlist'),
    api.get('/analysis/next-term'),
    api.get('/analysis/term-plans'),
  ]);
  rooms.value = r.data;
  waitlist.value = w.data;
  nextTerm.value = n.data;
  plans.value = p.data;
}

function adopt(row: any) {
  Object.assign(planForm, {
    term: '2026年秋季二期',
    category: row.category,
    current_classes: row.classes,
    planned_classes: row.suggested_classes,
    waitlist_pressure: row.pressure,
    decision_note: row.suggestion,
  });
  planDlg.value = true;
}

async function savePlan() {
  if (!planForm.term || !planForm.category) {
    ElMessage.warning('请填写期次与类别');
    return;
  }
  try {
    await api.post('/analysis/term-plans', planForm);
    ElMessage.success('规划已保存');
    planDlg.value = false;
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

onMounted(() => {
  meta.load();
  load();
});
</script>
