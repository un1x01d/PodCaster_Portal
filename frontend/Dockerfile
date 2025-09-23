# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json ./package.json
# COPY frontend/package-lock.json ./package-lock.json
RUN npm ci || npm i
COPY frontend/. .
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# --- runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
RUN npm i vite@^5.4.8 --omit=dev
EXPOSE 5173
CMD ["npx","vite","preview","--host","--port","5173"]

