# Native Linux build dependencies and binaries; no publishing or runtime server.
FROM node:24-bookworm
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN git init -b packaging && git add -N . && make build && make lint && node scripts/check-docs.js
ENTRYPOINT ["node_modules/.bin/electron-builder"]
CMD ["--linux", "AppImage", "deb", "--publish", "never", "--config.directories.output=/out"]
