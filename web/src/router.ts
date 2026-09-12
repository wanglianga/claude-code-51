import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { title: '登录' } },
    {
      path: '/',
      component: () => import('./views/LayoutView.vue'),
      children: [
        { path: '', component: () => import('./views/DashboardView.vue'), meta: { title: '工作台' } },
        { path: 'courses', component: () => import('./views/CoursesView.vue'), meta: { title: '课程管理' } },
        { path: 'courses/:id', component: () => import('./views/CourseDetailView.vue'), meta: { title: '课程详情' } },
        { path: 'enrollments', component: () => import('./views/EnrollmentsView.vue'), meta: { title: '报名与候补' } },
        { path: 'attendance', component: () => import('./views/AttendanceView.vue'), meta: { title: '课次考勤' } },
        { path: 'leaves', component: () => import('./views/LeavesView.vue'), meta: { title: '请假与补课' } },
        { path: 'finance', component: () => import('./views/FinanceView.vue'), meta: { title: '退费与转班' } },
        { path: 'students', component: () => import('./views/StudentsView.vue'), meta: { title: '学员档案' } },
        { path: 'events', component: () => import('./views/EventsView.vue'), meta: { title: '展演活动' } },
        { path: 'resources', component: () => import('./views/ResourcesView.vue'), meta: { title: '资源与规划' } },
        { path: 'audit', component: () => import('./views/AuditView.vue'), meta: { title: '流水档案' } },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.path !== '/login' && !auth.isLogged) return '/login';
  if (to.path === '/login' && auth.isLogged) return '/';
  document.title = `${to.meta.title || ''} · 社区老年大学`;
  return true;
});

export default router;
