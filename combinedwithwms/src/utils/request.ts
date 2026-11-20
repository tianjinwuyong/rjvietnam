import axios from 'axios';

// 统一 HTTP 客户端：开发时 baseURL 为空，经 Vite 代理 /api 转发到 WMS 服务；
// 生产可设置 VITE_WMS_API_URL 直连网关。
const request = axios.create({
  baseURL: import.meta.env.VITE_WMS_API_URL || '',
  timeout: 15000,
});

request.interceptors.response.use(
  (response) => response,
  (error) => {
    // 统一的错误提示可在此扩展
    return Promise.reject(error);
  },
);

export default request;
