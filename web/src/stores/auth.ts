import { defineStore } from 'pinia';
import { api } from '../api';

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'staff' | 'teacher';
  teacher_id: number | null;
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null') as User | null,
  }),
  getters: {
    isLogged: (s) => !!s.token,
    canManage: (s) => ['admin', 'staff'].includes(s.user?.role || ''),
    roleName: (s) =>
      ({ admin: '管理员', staff: '工作人员', teacher: '教师' } as Record<string, string>)[s.user?.role || ''] || '未知',
  },
  actions: {
    async login(username: string, password: string) {
      const { data } = await api.post('/auth/login', { username, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    },
  },
});
