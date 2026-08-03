FROM node:22-slim
WORKDIR /app

# Manifeste zuerst für Layer-Caching (Root + web-Workspace)
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm ci

# Rest kopieren und Server + Web-SPA bauen
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["sh", "-c", "npm run db:migrate && npm start"]
