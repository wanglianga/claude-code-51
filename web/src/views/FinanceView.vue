<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">退费与转班</div>
      <div v-if="auth.canManage">
        <el-button type="danger" plain :icon="Money" @click="openRefund">新建退费</el-button>
        <el-button type="primary" :icon="Switch" @click="openTransfer">办理转班</el-button>
      </div>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="退费管理" name="refunds">
        <el-card shadow="never">
          <div class="filter-bar" style="margin-bottom: 10px">
            <el-radio-group v-model="refundStatus" size="small" @change="loadRefunds">
              <el-radio-button value="">全部</el-radio-button>
              <el-radio-button value="待审核">待审核</el-radio-button>
              <el-radio-button value="已退费">已退费</el-radio-button>
              <el-radio-button value="已拒绝">已拒绝</el-radio-button>
            </el-radio-group>
          </div>
          <el-table :data="refunds" size="small">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="course_title" label="课程" width="140" />
            <el-table-column prop="amount" label="金额(元)" width="90" />
            <el-table-column prop="reason_type" label="类型" width="90">
              <template #default="{ row }"><el-tag size="small" type="warning">{{ row.reason_type }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />
            <el-table-column prop="status" label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="({ 待审核: 'warning', 已退费: 'success', 已拒绝: 'info' } as Record<string, string>)[row.status] as any" size="small">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="handled_by" label="处理人" width="110">
              <template #default="{ row }">{{ row.handled_by || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <template v-if="row.status === '待审核' && auth.canManage">
                  <el-button link type="success" size="small" @click="approveRefund(row)">通过</el-button>
                  <el-button link type="danger" size="small" @click="rejectRefund(row)">拒绝</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="转班记录" name="transfers">
        <el-card shadow="never">
          <el-table :data="transfers" size="small">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column label="转班" min-width="240">
              <template #default="{ row }">{{ row.from_title }} → {{ row.to_title }}</template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" min-width="220" show-overflow-tooltip />
            <el-table-column prop="created_by" label="经办人" width="140" />
            <el-table-column label="时间" width="150">
              <template #default="{ row }">{{ row.created_at?.replace('T', ' ').slice(0, 16) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建退费 -->
    <el-dialog v-model="refundDlg" title="新建退费申请" width="500px">
      <el-form label-width="90px">
        <el-form-item label="报名记录" required>
          <el-select v-model="refundForm.enrollment_id" filterable style="width: 100%" @change="onRefundEnrollment">
            <el-option
              v-for="e in paidEnrollments"
              :key="e.id"
              :label="`${e.student_name} · ${e.course_title}（已缴${e.fee_amount}元）`"
              :value="e.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="退费金额" required>
          <el-input-number v-model="refundForm.amount" :min="1" :max="9999" style="width: 50%" />
        </el-form-item>
        <el-form-item label="退费类型" required>
          <el-select v-model="refundForm.reason_type" style="width: 100%">
            <el-option v-for="t in meta.refundReasonTypes" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因说明">
          <el-input v-model="refundForm.reason" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundDlg = false">取消</el-button>
        <el-button type="primary" @click="saveRefund">提交</el-button>
      </template>
    </el-dialog>

    <!-- 办理转班 -->
    <el-dialog v-model="transferDlg" title="办理转班（临时换班）" width="500px">
      <el-form label-width="90px">
        <el-form-item label="报名记录" required>
          <el-select v-model="transferForm.enrollment_id" filterable style="width: 100%">
            <el-option
              v-for="e in activeEnrollments"
              :key="e.id"
              :label="`${e.student_name} · ${e.course_title}（${e.status}）`"
              :value="e.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="目标课程" required>
          <el-select v-model="transferForm.to_course_id" filterable style="width: 100%">
            <el-option
              v-for="c in courses.filter((x) => ['报名中', '已开班'].includes(x.status))"
              :key="c.id"
              :label="`${c.title}（${c.confirmed_count}/${c.capacity}）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="转班原因" required>
          <el-input v-model="transferForm.reason" type="textarea" :rows="2" placeholder="如：腰椎不适，医生建议减少舞蹈运动" />
        </el-form-item>
        <el-alert type="info" :closable="false" title="转班后原课程空出名额将按候补顺序递补；缴费状态随学员转入新课程" />
      </el-form>
      <template #footer>
        <el-button @click="transferDlg = false">取消</el-button>
        <el-button type="primary" @click="saveTransfer">确认转班</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Money, Switch } from '@element-plus/icons-vue';
import { api, errMsg } from '../api';
import { useMetaStore } from '../stores/meta';
import { useAuthStore } from '../stores/auth';

const meta = useMetaStore();
const auth = useAuthStore();
const tab = ref('refunds');
const refunds = ref<any[]>([]);
const transfers = ref<any[]>([]);
const refundStatus = ref('');

const refundDlg = ref(false);
const paidEnrollments = ref<any[]>([]);
const refundForm = reactive({ enrollment_id: null as number | null, amount: 0, reason_type: '学员退课', reason: '' });

const transferDlg = ref(false);
const activeEnrollments = ref<any[]>([]);
const courses = ref<any[]>([]);
const transferForm = reactive({ enrollment_id: null as number | null, to_course_id: null as number | null, reason: '' });

async function loadRefunds() {
  const { data } = await api.get('/refunds', { params: { status: refundStatus.value } });
  refunds.value = data;
}

async function loadTransfers() {
  const { data } = await api.get('/transfers');
  transfers.value = data;
}

async function openRefund() {
  const { data } = await api.get('/enrollments');
  paidEnrollments.value = data.filter((e: any) => e.fee_status === '已缴');
  Object.assign(refundForm, { enrollment_id: null, amount: 0, reason_type: '学员退课', reason: '' });
  refundDlg.value = true;
}

function onRefundEnrollment(eid: number) {
  const en = paidEnrollments.value.find((e) => e.id === eid);
  if (en) refundForm.amount = en.fee_amount;
}

async function saveRefund() {
  if (!refundForm.enrollment_id || !refundForm.amount) {
    ElMessage.warning('请选择报名记录并填写金额');
    return;
  }
  try {
    await api.post('/refunds', refundForm);
    ElMessage.success('退费申请已提交，待审核');
    refundDlg.value = false;
    loadRefunds();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function approveRefund(row: any) {
  try {
    await ElMessageBox.confirm(`确认为 ${row.student_name} 退费 ${row.amount} 元？`, '退费审核', { type: 'warning' });
    await api.post(`/refunds/${row.id}/approve`);
    ElMessage.success('退费已完成');
    loadRefunds();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function rejectRefund(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('请填写拒绝原因：', '拒绝退费', {
      inputValidator: (v) => !!v || '请填写原因',
    });
    await api.post(`/refunds/${row.id}/reject`, { note: value });
    ElMessage.success('已拒绝');
    loadRefunds();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function openTransfer() {
  const [e, c] = await Promise.all([api.get('/enrollments'), api.get('/courses')]);
  activeEnrollments.value = e.data.filter((x: any) => ['已录取', '候补'].includes(x.status));
  courses.value = c.data;
  Object.assign(transferForm, { enrollment_id: null, to_course_id: null, reason: '' });
  transferDlg.value = true;
}

async function saveTransfer() {
  if (!transferForm.enrollment_id || !transferForm.to_course_id || !transferForm.reason) {
    ElMessage.warning('请完整填写转班信息');
    return;
  }
  try {
    await api.post('/transfers', transferForm);
    ElMessage.success('转班完成');
    transferDlg.value = false;
    loadTransfers();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

onMounted(() => {
  meta.load();
  loadRefunds();
  loadTransfers();
});
</script>
