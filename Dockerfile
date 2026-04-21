# 多阶段构建：builder阶段用于安装依赖和构建，production阶段用于运行
FROM node:22-alpine AS builder

# 安装pnpm
RUN npm install -g pnpm

WORKDIR /app

# 复制包管理文件和锁定文件
COPY package.json pnpm-lock.yaml ./

# 安装依赖（包括devDependencies）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 构建项目
RUN pnpm run build

# 生产运行阶段
FROM node:22-alpine AS production

WORKDIR /app

# 安装pnpm（生产环境也需要，用于安装生产依赖）
RUN npm install -g pnpm

# 复制package.json和pnpm-lock.yaml
COPY package.json pnpm-lock.yaml ./

# 安装生产依赖（不包括devDependencies）
RUN pnpm install --frozen-lockfile --prod

# 从builder阶段复制构建产物
COPY --from=builder /app/dist ./dist
# 复制其他必要文件（如apps目录，用于本地开发模式）
COPY --from=builder /app/apps ./apps

# 暴露端口（与应用配置一致）
EXPOSE 3001

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 启动应用
CMD ["node", "dist/index.js"]