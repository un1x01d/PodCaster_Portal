# backend/Dockerfile
FROM node:20-alpine
WORKDIR /app

# copy ONLY backend deps, then install
COPY backend/package.json ./package.json
# COPY backend/package-lock.json ./package-lock.json   # if you have it
RUN npm ci --omit=dev || npm i --omit=dev

# copy backend source (node_modules is preserved because .dockerignore excludes it)
COPY backend/. .

EXPOSE 4000
CMD ["node","server.js"]

