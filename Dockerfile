# ---- 构建阶段 ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 只保留生产依赖
RUN npm ci --omit=dev

# ---- 运行阶段 ----
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# 目标机器内存有限，限制 V8 堆上限避免挤占其他服务
ENV NODE_OPTIONS=--max-old-space-size=192

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# 使用非 root 用户运行
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
