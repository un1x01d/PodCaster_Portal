FROM node:22-alpine AS build
WORKDIR /app

COPY frontend/package.json ./package.json
COPY frontend/package-lock.json ./package-lock.json

RUN sh -c 'if [ -s package-lock.json ] && node -e "const fs=require(\"fs\");const p=JSON.parse(fs.readFileSync(\"package-lock.json\",\"utf8\"));if(!p||!p.lockfileVersion) process.exit(1);"; then npm ci; else echo "No valid package-lock.json; falling back to npm install"; npm install --no-audit --no-fund; fi'

COPY frontend/. .
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}
ENV CI=true
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5173

COPY --from=build /app/dist ./dist
RUN npm i -g serve@14

RUN chown -R node:node /app
USER node

EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
