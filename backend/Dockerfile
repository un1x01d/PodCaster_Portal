# backend/Dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy ONLY backend deps, then install
COPY backend/package.json ./package.json
COPY backend/package-lock.json ./package-lock.json
RUN npm ci --omit=dev

# copy backend source (node_modules is preserved because .dockerignore excludes it)
COPY backend/. .

RUN chown -R node:node /app
USER node

EXPOSE 4000
CMD ["node","--max-old-space-size=8192","server.js"]
