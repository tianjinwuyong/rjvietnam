# combinedwithwms

瑞晶 WMS 综合前端 —— 与 `wms/` 独立服务对接的 Vue 3 + Vite 单页应用。

## 定位

- 作为 WMS（NestJS 后端 + 原 React 客户端）之上的**综合前端入口**，聚合看板、跨模块视图等。
- 通过 `/api` 代理对接 WMS 后端（开发默认 `http://localhost:3000`）。
- 与 `wms/` 平级，属于 `submain/rjvnms` 子主线下的独立子项目。

## 技术栈

- Vue 3.5 + TypeScript
- Vite 5
- vue-router 4（多视图路由）
- Pinia（状态管理）
- axios（HTTP 客户端，封装于 `src/utils/request.ts`）

## 快速开始

```bash
# 安装依赖（已配置 npmmirror 镜像）
npm install

# 开发（默认端口 5174）
npm run dev

# 类型检查 + 生产构建
npm run build

# 本地预览构建产物
npm run preview
```

## 目录结构

```
combinedwithwms/
├── index.html
├── vite.config.ts          # Vite 配置 + /api 代理到 WMS 服务
├── tsconfig.json
├── src/
│   ├── main.ts             # 应用入口（挂载 Pinia + Router）
│   ├── App.vue             # 根组件（布局 + 导航）
│   ├── router/index.ts     # 路由
│   ├── stores/             # Pinia stores
│   ├── api/wms.ts          # WMS 后端接口封装
│   ├── utils/request.ts    # axios 实例（baseURL + 拦截器）
│   ├── views/              # 页面级组件
│   ├── components/         # 通用组件
│   └── assets/main.css     # 全局样式
```

## 对接 WMS

- 所有后端请求走 `/api` 前缀，开发环境由 Vite 代理转发到 `VITE_WMS_API_URL`（默认 `http://localhost:3000`）。
- 接口封装见 `src/api/wms.ts`，按需补充收料 / IQC / 库存 / 盘点等模块调用。
- 生产环境可将 `VITE_WMS_API_URL` 指向真实 WMS 网关地址，或保持为空由 Nginx 统一反代。
