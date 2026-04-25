# backend/Dockerfile
FROM node:20-alpine
WORKDIR /app

# copy ONLY backend deps, then install
COPY backend/package.json ./package.json
COPY backend/package-lock.json ./package-lock.json
RUN npm ci --omit=dev

# copy backend source (node_modules is preserved because .dockerignore excludes it)
COPY backend/. .

RUN chown -R node:node /app
USER node

EXPOSE 4000
CMD ["node","server.js"]
