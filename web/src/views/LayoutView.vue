<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">🎓 社区老年大学</div>
      <el-menu :default-active="$route.path" router background-color="#1f2d3d" text-color="#bfcbd9" active-text-color="#ffd04b">
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon><span>工作台</span>
        </el-menu-item>
        <el-menu-item index="/courses">
          <el-icon><Reading /></el-icon><span>课程管理</span>
        </el-menu-item>
        <el-menu-item index="/enrollments">
          <el-icon><EditPen /></el-icon><span>报名与候补</span>
        </el-menu-item>
        <el-menu-item index="/attendance">
          <el-icon><Checked /></el-icon><span>课次考勤</span>
        </el-menu-item>
        <el-menu-item index="/leaves">
          <el-icon><Calendar /></el-icon><span>请假与补课</span>
        </el-menu-item>
        <el-menu-item index="/finance">
          <el-icon><Money /></el-icon><span>退费与转班</span>
        </el-menu-item>
        <el-menu-item index="/students">
          <el-icon><User /></el-icon><span>学员档案</span>
        </el-menu-item>
        <el-menu-item index="/events">
          <el-icon><Flag /></el-icon><span>展演活动</span>
        </el-menu-item>
        <el-menu-item index="/resources">
          <el-icon><OfficeBuilding /></el-icon><span>资源与规划</span>
        </el-menu-item>
        <el-menu-item index="/audit">
          <el-icon><Document /></el-icon><span>流水档案</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="crumb">{{ $route.meta.title }}</div>
        <el-dropdown @command="onCommand">
          <span class="user">
            {{ auth.user?.name }}
            <el-tag size="small" style="margin-left: 6px">{{ auth.roleName }}</el-tag>
            <el-icon style="margin-left: 4px"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  Odometer, Reading, EditPen, Checked, Calendar, Money, User, Flag, OfficeBuilding, Document, ArrowDown,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useMetaStore } from '../stores/meta';

const auth = useAuthStore();
const meta = useMetaStore();
const router = useRouter();

onMounted(() => meta.load());

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    auth.logout();
    router.push('/login');
  }
}
</script>

<style scoped>
.layout {
  min-height: 100vh;
}
.aside {
  background: #1f2d3d;
}
.logo {
  color: #fff;
  font-weight: 700;
  padding: 18px 16px;
  font-size: 16px;
}
.aside :deep(.el-menu) {
  border-right: none;
}
.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
}
.crumb {
  font-weight: 600;
  color: #303133;
}
.user {
  cursor: pointer;
  display: flex;
  align-items: center;
  color: #606266;
}
.main {
  padding: 0;
  background: #f5f7fa;
}
</style>
