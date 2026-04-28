# syntax=docker/dockerfile:1.7-labs

###########
# Build   #
###########
FROM node:22-alpine AS build
WORKDIR /app

# Maximize cache hits
COPY frontend/package.json ./package.json
COPY frontend/package-lock.json ./package-lock.json

# Faster installs (BuildKit cache), no audit/fund noise
RUN --mount=type=cache,target=/root/.npm \
    sh -c 'if [ -s package-lock.json ] && node -e "const fs=require(\"fs\");const p=JSON.parse(fs.readFileSync(\"package-lock.json\",\"utf8\"));if(!p||!p.lockfileVersion) process.exit(1);"; then npm ci; else echo "No valid package-lock.json; falling back to npm install"; npm install --no-audit --no-fund; fi'

# Add source and build
COPY frontend/. .
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}
ENV CI=true
# Build is optional if we override CMD, but good for caching deps
RUN --mount=type=cache,target=/root/.npm \
    npm run build

############
# Runtime  #
############
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5173

# Only static assets + tiny server
COPY --from=build /app/dist ./dist

# Install 'serve' to host static files
RUN npm i -g serve@14

RUN chown -R node:node /app
USER node

EXPOSE ${PORT}
# -s = single-page app fallback, -l = listen
CMD ["serve", "-s", "dist", "-l", "5173"]
