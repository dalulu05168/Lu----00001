# Independent App browser preview branch; does not package Android/iOS binaries.
FROM node:22-bookworm-slim AS builder
WORKDIR /workspace/mobile
COPY mobile/ ./
RUN npm install --no-audit --no-fund
RUN npm run check
RUN npm run build:web

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /workspace/mobile/dist-web/ /usr/share/nginx/html/
EXPOSE 8080
