FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libxshmfence1 libxkbcommon0 libxrender1 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npx playwright install chromium
COPY src ./src
COPY tests ./tests
ENTRYPOINT ["node", "src/runner.mjs"]
