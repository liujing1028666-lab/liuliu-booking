# 刘刘的预约小站 —— Docker 镜像（自托管 / VPS 用）
FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
# 数据存到挂载卷 /data，重启不丢
ENV DATA_FILE=/data/bookings.json
RUN mkdir -p /data

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
