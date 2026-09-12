import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/** 从 axios 错误中提取后端错误信息 */
export function errMsg(e: any): string {
  return e?.response?.data?.error || e?.message || '请求失败';
}
