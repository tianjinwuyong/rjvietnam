import axios from 'axios';
import { toast } from 'sonner';
import { tui, translate } from '../i18n';
import { extractApiError } from '../utils/apiError';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '/';

const request = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach JWT token
request.interceptors.request.use(
  (config) => {
    try {
      const saved = localStorage.getItem('wms-user');
      if (saved) {
        const user = JSON.parse(saved);
        if (user.token) {
          config.headers.Authorization = `Bearer ${user.token}`;
        }
      }
    } catch {
      // ignore
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor: handle 401 / 403
request.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    if (status === 401) {
      localStorage.removeItem('wms-user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (status === 403) {
      // 无权限操作：统一友好提示，避免跳到错误页
      const raw = extractApiError(error).message;
      toast.error(tui(raw) || translate('ui.noPermissionMsg'));
    }
    return Promise.reject(error);
  },
);

export default request;
