# syntax=docker/dockerfile:1
# ------------------------------------------------------------------
# WMS 运行镜像
# 构建时只需 package-lock.json（依赖在容器内安装，不依赖构建机平台），
# 因此 Windows 上打好的源码包可以直接在 Linux 上构建。
# ------------------------------------------------------------------
FROM node:22-bookworm-slim

WORKDIR /app

# 1) 先装生产依赖（单独的层，改代码不用重装依赖）
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# 2) 再拷程序与安装期需要的脚本
COPY app/dist   ./dist
COPY app/tools  ./tools
COPY app/assets ./assets

ENV NODE_ENV=production
EXPOSE 3000 3443

# 容器内自检：能打开首页即视为健康
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVER_PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
