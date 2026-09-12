# ---------- 前端构建 ----------
FROM node:22-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 后端构建 ----------
FROM node:22-alpine AS server-builder
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---------- 运行时 ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# 仅安装生产依赖
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 后端产物 + SQL schema + 前端静态资源
COPY --from=server-builder /build/server/dist ./dist
COPY server/src/schema.sql ./dist/schema.sql
COPY --from=web-builder /build/web/dist ./public

# 非 root 运行（node 镜像自带 node 用户）
RUN chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js"]
