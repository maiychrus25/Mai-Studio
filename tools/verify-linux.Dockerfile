# Development verification only; this is not the desktop distribution or a deployment image.
FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
# Use the native Linux FFmpeg installed in this isolated container, never the host macOS binary.
RUN cp /usr/bin/ffmpeg node_modules/ffmpeg-static/ffmpeg && git init -b verification && make build && make lint && node scripts/check-docs.js
CMD ["node", "--test", "--test-concurrency=1", "dist/tests/store.test.js", "dist/tests/queue.test.js", "dist/tests/security.test.js", "dist/tests/media.test.js", "dist/tests/pipelines.test.js", "dist/tests/integrations.test.js", "dist/tests/codex.test.js", "dist/tests/hub.test.js", "dist/tests/studio.test.js", "dist/tests/updates.test.js", "dist/tests/docs.test.js"]
