<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="brand">
        <div class="logo">🎓</div>
        <h2>社区老年大学课程管理平台</h2>
        <p class="sub">课程报名 · 请假补课 · 考勤 · 退费 · 展演 · 资源规划</p>
      </div>
      <el-form @submit.prevent="doLogin">
        <el-form-item>
          <el-input v-model="username" placeholder="用户名" size="large" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="password"
            type="password"
            placeholder="密码"
            size="large"
            show-password
            :prefix-icon="Lock"
            @keyup.enter="doLogin"
          />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="doLogin">
          登 录
        </el-button>
      </el-form>
      <el-divider content-position="left">演示账号（点击填充）</el-divider>
      <div class="demo-accounts">
        <el-tag
          v-for="a in demoAccounts"
          :key="a.u"
          class="acc"
          :type="a.tag"
          @click="fill(a.u, a.p)"
        >
          {{ a.label }} {{ a.u }}
        </el-tag>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { errMsg } from '../api';

const router = useRouter();
const auth = useAuthStore();
const username = ref('');
const password = ref('');
const loading = ref(false);

const demoAccounts = [
  { label: '管理员', u: 'admin', p: 'admin123', tag: 'danger' as const },
  { label: '工作人员', u: 'staff01', p: 'staff123', tag: 'primary' as const },
  { label: '书法教师', u: 'teacher01', p: 'teacher123', tag: 'success' as const },
  { label: '声乐教师', u: 'teacher02', p: 'teacher123', tag: 'success' as const },
];

function fill(u: string, p: string) {
  username.value = u;
  password.value = p;
}

async function doLogin() {
  if (!username.value || !password.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    ElMessage.success(`欢迎，${auth.user?.name}`);
    router.push('/');
  } catch (e) {
    ElMessage.error(errMsg(e));
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.login-card {
  width: 420px;
  border-radius: 12px;
}
.brand {
  text-align: center;
  margin-bottom: 18px;
}
.logo {
  font-size: 42px;
}
.brand h2 {
  margin: 8px 0 4px;
  font-size: 20px;
}
.sub {
  color: #909399;
  font-size: 12px;
  margin: 0;
}
.demo-accounts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.acc {
  cursor: pointer;
}
</style>
