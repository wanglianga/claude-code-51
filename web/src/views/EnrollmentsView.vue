<template>
  <div class="page">
    <div class="page-header">
      <div class="page-title">报名与候补</div>
      <el-button v-if="auth.canManage" type="primary" :icon="Plus" @click="openNew">新报名</el-button>
    </div>

    <el-tabs v-model="tab">
      <el-tab-pane label="报名记录" name="list">
        <div class="filter-bar" style="margin-bottom: 12px">
          <el-input v-model="filters.kw" placeholder="学员/课程名" clearable style="width: 180px" @change="load" />
          <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px" @change="load">
            <el-option v-for="s in ['已录取', '候补', '长期请假', '已退课', '已转班']" :key="s" :label="s" :value="s" />
          </el-select>
          <el-select v-model="filters.course_id" placeholder="课程" clearable style="width: 180px" @change="load">
            <el-option v-for="c in courses" :key="c.id" :label="c.title" :value="c.id" />
          </el-select>
        </div>

        <el-card shadow="never">
          <el-table :data="rows" v-loading="loading" size="small">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="course_title" label="课程" width="140" />
            <el-table-column prop="age" label="年龄" width="60" />
            <el-table-column prop="level" label="基础水平" width="80" />
            <el-table-column label="座位" width="60">
              <template #default="{ row }">{{ row.seat_no ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="代办" width="70">
              <template #default="{ row }">
                <el-tooltip v-if="row.proxy_name" :content="`${row.proxy_name}（${row.proxy_relation}）${row.proxy_phone}`">
                  <el-tag size="small" type="info">代办</el-tag>
                </el-tooltip>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column prop="health_limits" label="健康限制" width="110" show-overflow-tooltip />
            <el-table-column prop="source" label="来源" width="90" />
            <el-table-column label="缴费" width="76">
              <template #default="{ row }">
                <el-tag :type="({ 已缴: 'success', 未缴: 'danger', 部分退: 'warning', 已退: 'info' } as Record<string, string>)[row.fee_status] as any" size="small">
                  {{ row.fee_status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="({ 已录取: 'success', 候补: 'warning', 长期请假: 'warning', 已退课: 'info', 已转班: 'info' } as Record<string, string>)[row.status] as any" size="small">
                  {{ row.status }}{{ row.status === '候补' ? `#${row.waitlist_position}` : '' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="230" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openTimeline(row)">时间线</el-button>
                <template v-if="auth.canManage">
                  <el-button v-if="row.fee_status === '未缴'" link type="success" size="small" @click="pay(row)">缴费</el-button>
                  <el-button v-if="row.status === '候补'" link type="primary" size="small" @click="promote(row)">转正</el-button>
                  <el-button v-if="row.status === '已录取'" link type="warning" size="small" @click="longLeave(row)">长期请假</el-button>
                  <el-button v-if="row.status === '长期请假'" link type="success" size="small" @click="restore(row)">恢复</el-button>
                  <el-button v-if="['已录取', '候补'].includes(row.status)" link type="danger" size="small" @click="drop(row)">退课</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 转正通知中心 -->
      <el-tab-pane label="转正通知" name="offers">
        <el-card shadow="never">
          <div class="filter-bar" style="margin-bottom: 10px">
            <el-radio-group v-model="offerStatus" size="small" @change="loadOffers">
              <el-radio-button value="">全部</el-radio-button>
              <el-radio-button value="待确认">待确认</el-radio-button>
              <el-radio-button value="已确认">已确认</el-radio-button>
              <el-radio-button value="已顺延">已顺延</el-radio-button>
              <el-radio-button value="已过期">已过期</el-radio-button>
            </el-radio-group>
            <el-select v-model="offerCourseId" placeholder="全部课程" clearable style="width: 180px" @change="loadOffers">
              <el-option v-for="c in courses" :key="c.id" :label="c.title" :value="c.id" />
            </el-select>
            <el-button v-if="auth.canManage" type="primary" plain size="small" @click="openPush">推送转正通知</el-button>
          </div>
          <el-table :data="offers" size="small" v-loading="offersLoading">
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="course_title" label="课程" width="140" />
            <el-table-column label="候补位次" width="80">
              <template #default="{ row }">第{{ row.queue_position }}位</template>
            </el-table-column>
            <el-table-column prop="level" label="基础水平" width="80" />
            <el-table-column prop="note" label="名额来源" min-width="170" show-overflow-tooltip />
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="({ 待确认: 'warning', 已确认: 'success', 已顺延: 'info', 已过期: 'info', 已取消: 'info' } as Record<string, string>)[row.status] as any" size="small">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="顺延/过期原因" min-width="170" show-overflow-tooltip>
              <template #default="{ row }">{{ row.reason || '—' }}</template>
            </el-table-column>
            <el-table-column label="确认时限" width="140">
              <template #default="{ row }">
                <span v-if="row.status === '待确认'">{{ row.expires_at?.replace('T', ' ').slice(5, 16) }}</span>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <template v-if="row.status === '待确认' && auth.canManage">
                  <el-button link type="success" size="small" @click="confirmOffer(row)">确认转正</el-button>
                  <el-button link type="warning" size="small" @click="declineOffer(row)">顺延</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新报名 -->
    <el-dialog v-model="newDlg" title="新报名" width="560px">
      <el-form label-width="90px">
        <el-form-item label="学员" required>
          <el-select v-model="form.student_id" filterable style="width: 100%" placeholder="搜索学员">
            <el-option v-for="s in students" :key="s.id" :label="`${s.name}（${2026 - s.birth_year}岁）`" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="课程" required>
          <el-select v-model="form.course_id" filterable style="width: 100%">
            <el-option
              v-for="c in courses.filter((x) => ['报名中', '已开班'].includes(x.status))"
              :key="c.id"
              :label="`${c.title}（${c.confirmed_count}/${c.capacity}${c.waitlist_count ? '，候补' + c.waitlist_count : ''}）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="基础水平">
          <el-select v-model="form.level" style="width: 100%">
            <el-option v-for="l in meta.levels" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="健康限制"><el-input v-model="form.health_limits" placeholder="默认取学员档案" /></el-form-item>
        <el-form-item label="报名来源">
          <el-select v-model="form.source" style="width: 100%">
            <el-option v-for="s in meta.sources" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="家属代办">
          <el-checkbox v-model="form.is_proxy">由家属代办报名（需完整填写代办人信息）</el-checkbox>
        </el-form-item>
        <template v-if="form.is_proxy">
          <el-form-item label="代办人" required><el-input v-model="form.proxy_name" placeholder="代办人姓名" /></el-form-item>
          <el-form-item label="关系" required>
            <el-select v-model="form.proxy_relation" style="width: 100%">
              <el-option v-for="r in ['子女', '配偶', '亲属', '其他']" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item label="联系电话" required><el-input v-model="form.proxy_phone" placeholder="代办人联系电话" /></el-form-item>
        </template>
        <el-alert type="info" :closable="false">
          提交时将自动校验：年龄（50-85岁，舞蹈类≤80岁）、与已报兴趣班的时间冲突、家属代办信息完整性；课程已满自动进入候补队列
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="newDlg = false">取消</el-button>
        <el-button type="primary" @click="saveNew">提交报名</el-button>
      </template>
    </el-dialog>

    <!-- 推送转正通知 -->
    <el-dialog v-model="pushDlg" title="推送转正通知" width="640px">
      <el-form label-width="90px">
        <el-form-item label="课程" required>
          <el-select v-model="pushCourseId" style="width: 100%" @change="loadCandidates">
            <el-option
              v-for="c in courses.filter((x) => x.waitlist_count > 0)"
              :key="c.id"
              :label="`${c.title}（候补${c.waitlist_count}人）`"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <template v-if="candidates">
          <el-alert
            v-if="candidates.hot"
            type="warning"
            :closable="false"
            :title="`热门课程（候补${candidates.waitlistCount}人 ≥ ${candidates.threshold}人）：只能按候补顺序推送第一位可录取者，不能手工插队`"
            style="margin-bottom: 10px"
          />
          <el-table :data="candidates.candidates" size="small" max-height="300">
            <el-table-column label="位次" width="60">
              <template #default="{ row }">#{{ row.waitlist_position }}</template>
            </el-table-column>
            <el-table-column prop="student_name" label="学员" width="90" />
            <el-table-column prop="level" label="基础水平" width="80" />
            <el-table-column prop="age" label="年龄" width="60" />
            <el-table-column prop="fee_status" label="缴费" width="70" />
            <el-table-column label="可推送性" min-width="200">
              <template #default="{ row }">
                <el-tag v-if="row.eligible" type="success" size="small">可推送</el-tag>
                <el-tooltip v-else-if="row.time_conflict" :content="`与「${row.time_conflict.title}」周${row.time_conflict.weekday} ${row.time_conflict.start_time}-${row.time_conflict.end_time} 冲突`">
                  <el-tag type="danger" size="small">时间冲突</el-tag>
                </el-tooltip>
                <el-tooltip v-else-if="row.declined_before" :content="row.declined_before">
                  <el-tag type="info" size="small">曾被顺延</el-tag>
                </el-tooltip>
                <el-tag v-else type="warning" size="small">已有待确认通知</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button
                  v-if="row.eligible && !candidates.hot"
                  link type="primary" size="small"
                  @click="pushTo(row)"
                >指定推送</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="pushDlg = false">关闭</el-button>
        <el-button type="primary" :disabled="!pushCourseId" @click="pushAuto">按顺序推送下一位</el-button>
      </template>
    </el-dialog>

    <!-- 报名时间线 -->
    <el-drawer v-model="tlDrawer" size="560px" :title="tl ? `${tl.enrollment.student_name} · ${tl.enrollment.course_title} · 全程档案` : ''">
      <template v-if="tl">
        <el-descriptions :column="2" border size="small" style="margin-bottom: 14px">
          <el-descriptions-item label="状态">{{ tl.enrollment.status }}</el-descriptions-item>
          <el-descriptions-item label="座位">{{ tl.enrollment.seat_no ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="缴费">{{ tl.enrollment.fee_status }}（{{ tl.enrollment.fee_amount }}元）</el-descriptions-item>
          <el-descriptions-item label="基础水平">{{ tl.enrollment.level }}</el-descriptions-item>
          <el-descriptions-item v-if="tl.enrollment.proxy_name" label="家属代办" :span="2">
            {{ tl.enrollment.proxy_name }}（{{ tl.enrollment.proxy_relation }}）{{ tl.enrollment.proxy_phone }}
          </el-descriptions-item>
        </el-descriptions>

        <el-tabs>
          <el-tab-pane label="全程时间线">
            <el-timeline style="padding-left: 4px">
              <el-timeline-item
                v-for="(item, i) in timelineItems"
                :key="i"
                :type="item.type"
                :timestamp="item.time"
              >
                <b>{{ item.title }}</b>
                <div v-if="item.desc" style="color: #909399; font-size: 12px">{{ item.desc }}</div>
              </el-timeline-item>
            </el-timeline>
          </el-tab-pane>
          <el-tab-pane :label="`考勤(${tl.attendances.length})`">
            <el-table :data="tl.attendances" size="small">
              <el-table-column label="课次" width="110">
                <template #default="{ row }">
                  第{{ row.session_no }}次
                  <el-tag v-if="row.is_makeup" type="warning" size="small">补</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="session_date" label="日期" width="100">
                <template #default="{ row }">{{ row.session_date?.slice(0, 10) }}</template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="80">
                <template #default="{ row }">
                  <el-tag :type="attType(row.status)" size="small">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="note" label="备注" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
          <el-tab-pane :label="`课程材料消耗(${tl.materialLogs.length})`">
            <el-table :data="tl.materialLogs" size="small">
              <el-table-column label="时间" width="140">
                <template #default="{ row }">{{ row.created_at?.replace('T', ' ').slice(0, 16) }}</template>
              </el-table-column>
              <el-table-column prop="material_name" label="材料" width="80" />
              <el-table-column label="变动" width="70">
                <template #default="{ row }">
                  <span :style="{ color: row.change_qty > 0 ? '#67c23a' : '#f56c6c' }">
                    {{ row.change_qty > 0 ? '+' : '' }}{{ row.change_qty }}{{ row.unit }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="reason" label="原因" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>
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
const tab = ref('list');
const rows = ref<any[]>([]);
const courses = ref<any[]>([]);
const students = ref<any[]>([]);
const loading = ref(false);
const newDlg = ref(false);
const filters = reactive({ kw: '', status: '', course_id: null as number | null });
const emptyForm = {
  student_id: null as number | null, course_id: null as number | null, level: '零基础',
  health_limits: '', source: '', is_proxy: false, proxy_name: '', proxy_relation: '', proxy_phone: '',
};
const form = reactive({ ...emptyForm });

const offers = ref<any[]>([]);
const offersLoading = ref(false);
const offerStatus = ref('');
const offerCourseId = ref<number | null>(null);
const pushDlg = ref(false);
const pushCourseId = ref<number | null>(null);
const candidates = ref<any>(null);

const tlDrawer = ref(false);
const tl = ref<any>(null);
const timelineItems = ref<any[]>([]);

function attType(s: string) {
  return ({ 签到: 'success', 迟到: 'warning', 请假: 'info', 缺席: 'danger', 代签异常: 'danger', 停课: 'info', 未签到: 'info' } as Record<string, string>)[s] as any;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/enrollments', { params: filters });
    rows.value = data;
  } finally {
    loading.value = false;
  }
}

async function loadRefs() {
  const [c, s] = await Promise.all([api.get('/courses'), api.get('/students')]);
  courses.value = c.data;
  students.value = s.data;
}

async function loadOffers() {
  offersLoading.value = true;
  try {
    const { data } = await api.get('/offers', { params: { status: offerStatus.value, course_id: offerCourseId.value } });
    offers.value = data;
  } finally {
    offersLoading.value = false;
  }
}

function openNew() {
  Object.assign(form, emptyForm);
  newDlg.value = true;
}

async function saveNew() {
  if (!form.student_id || !form.course_id) {
    ElMessage.warning('请选择学员与课程');
    return;
  }
  if (form.is_proxy && (!form.proxy_name || !form.proxy_relation || !form.proxy_phone)) {
    ElMessage.warning('家属代办须完整填写代办人姓名、关系、联系电话');
    return;
  }
  try {
    const { data } = await api.post('/enrollments', form);
    ElMessage.success(
      data.status === '候补' ? `课程已满，已进入候补第${data.waitlist_position}位` : `报名成功，座位${data.seat_no}号`
    );
    newDlg.value = false;
    load();
    loadRefs();
  } catch (e) {
    ElMessage.error(errMsg(e));
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
        const { value } = await ElMessageBox.prompt('课程已满，如需破格录取请填写原因：', '破格录取', {
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
      `确认 ${row.student_name} 退出「${row.course_title}」？空出名额将按候补顺序自动推送转正通知。`,
      '学员退课',
      { inputPlaceholder: '退课原因', inputValue: '学员主动退课', inputValidator: (v) => !!v || '请填写原因' }
    );
    const { data } = await api.post(`/enrollments/${row.id}/cancel`, { reason: value });
    ElMessage.success(data.offers?.length ? `已退课，已向${data.offers.length}位候补学员推送转正通知` : '已退课');
    load();
    loadOffers();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function longLeave(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(
      `将 ${row.student_name} 标记为长期请假？名额将临时空出并自动推送转正通知，恢复时可申请回班。`,
      '长期请假',
      { inputPlaceholder: '如：去外地子女家休养两个月', inputValidator: (v) => !!v || '请填写原因' }
    );
    const { data } = await api.post(`/enrollments/${row.id}/long-leave`, { reason: value });
    ElMessage.success(data.offers?.length ? `已标记，已向${data.offers.length}位候补学员推送转正通知` : '已标记长期请假');
    load();
    loadOffers();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function restore(row: any) {
  try {
    const { data } = await api.post(`/enrollments/${row.id}/restore`);
    ElMessage.success(data.status === '已录取' ? `已恢复，座位${data.seat}号` : `课程已满，已排到候补第${data.position}位`);
    load();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function openPush() {
  pushCourseId.value = null;
  candidates.value = null;
  pushDlg.value = true;
}

async function loadCandidates() {
  if (!pushCourseId.value) return;
  const { data } = await api.get(`/offers/candidates/${pushCourseId.value}`);
  candidates.value = data;
}

async function pushAuto() {
  try {
    const { data } = await api.post(`/offers/course/${pushCourseId.value}`, { note: '工作人员手动推送转正通知' });
    ElMessage.success(`已向${data.created.length}位候补学员推送转正通知`);
    pushDlg.value = false;
    loadOffers();
    loadRefs();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function pushTo(row: any) {
  try {
    await api.post(`/offers/course/${pushCourseId.value}`, { enrollment_id: row.enrollment_id, note: '工作人员指定推送' });
    ElMessage.success('已推送');
    pushDlg.value = false;
    loadOffers();
  } catch (e) {
    ElMessage.error(errMsg(e));
  }
}

async function confirmOffer(row: any) {
  try {
    await ElMessageBox.confirm(
      `确认 ${row.student_name} 转正进入「${row.course_title}」？将同步分配座位、更新缴费状态与教师名单，并检查教材库存。`,
      '确认转正',
      { type: 'success' }
    );
    const { data } = await api.post(`/offers/${row.id}/confirm`);
    ElMessage.success(
      `转正成功：座位${data.seat_no}号${data.fee_due > 0 ? `，待缴费${data.fee_due}元` : '，费用已缴清'}` +
        (data.material_warnings?.length ? `；⚠️ ${data.material_warnings.join('；')}` : '')
    );
    loadOffers();
    load();
    loadRefs();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function declineOffer(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(
      `确认 ${row.student_name} 暂时无法入学？将自动顺延下一位候补，原因保留在档案中。`,
      '未确认顺延',
      { inputPlaceholder: '如：去外地子女家，本月无法到校', inputValidator: (v) => !!v || '请填写原因' }
    );
    const { data } = await api.post(`/offers/${row.id}/decline`, { reason: value });
    ElMessage.success(data.next?.length ? '已顺延，并自动推送下一位' : '已顺延（暂无可推送的候补）');
    loadOffers();
  } catch (e: any) {
    if (e?.response) ElMessage.error(errMsg(e));
  }
}

async function openTimeline(row: any) {
  const { data } = await api.get(`/enrollments/${row.id}/timeline`);
  tl.value = data;
  const items: any[] = [];
  const push = (time: string, title: string, desc: string, type = 'primary') => items.push({ time, title, desc, type });
  push(data.enrollment.created_at?.replace('T', ' ').slice(0, 16), '报名', `状态：${data.enrollment.status}，来源：${data.enrollment.source}`);
  for (const o of data.offers || []) {
    push(
      o.offered_at?.replace('T', ' ').slice(0, 16),
      `转正通知（候补第${o.queue_position}位）→ ${o.status}`,
      o.reason || o.note,
      o.status === '已确认' ? 'success' : o.status === '待确认' ? 'warning' : 'info'
    );
  }
  for (const l of data.leaves) {
    push(l.created_at?.replace('T', ' ').slice(0, 16), `请假（${l.reason_type}）→ ${l.status}`, l.reason, l.status === '已批准' ? 'warning' : 'info');
  }
  for (const m of data.makeups) {
    push(m.created_at?.replace('T', ' ').slice(0, 16), `补课（${m.status}）`, m.note || '', m.status === '已完成' ? 'success' : 'warning');
  }
  for (const s of data.cancelledSessions) {
    push(s.session_date?.slice(0, 10), `第${s.session_no}次课停课`, s.cancel_reason, 'danger');
  }
  for (const t of data.transfers) {
    push(t.created_at?.replace('T', ' ').slice(0, 16), `转班：${t.from_title} → ${t.to_title}`, t.reason, 'warning');
  }
  for (const r of data.refunds) {
    push(r.created_at?.replace('T', ' ').slice(0, 16), `退费 ${r.amount}元（${r.reason_type}）→ ${r.status}`, r.reason, r.status === '已退费' ? 'success' : 'danger');
  }
  for (const a of data.attendances.filter((x: any) => ['代签异常', '缺席'].includes(x.status))) {
    push(a.session_date?.slice(0, 10), `考勤异常：${a.status}（第${a.session_no}次课）`, a.note, 'danger');
  }
  for (const a of data.audits) {
    push(a.created_at?.replace('T', ' ').slice(0, 16), `${a.action}（${a.actor}）`, a.reason, 'info');
  }
  timelineItems.value = items.filter((i) => i.time).sort((a, b) => (a.time < b.time ? -1 : 1));
  tlDrawer.value = true;
}

onMounted(() => {
  meta.load();
  load();
  loadRefs();
  loadOffers();
});
</script>
