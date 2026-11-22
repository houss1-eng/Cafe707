# Image de production du 707 (Render, Railway, Fly.io, un VPS…)
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
EXPOSE 3000
# La base est mise à jour (migrations) au démarrage
CMD ["node", "server.js"]
