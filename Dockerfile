# Image dùng chung cho DCMS (API + giao diện build sẵn) và kho tri thức SP-NV.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Cài dependency trước để tận dụng cache (postinstall của server cần schema Prisma)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY knowledge/package.json knowledge/
COPY server/prisma/schema.prisma server/prisma/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w web && sed -i "s/$//" deploy/*.sh && chmod +x deploy/*.sh
ENV NODE_ENV=production
