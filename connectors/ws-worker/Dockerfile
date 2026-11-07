FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY tests ./tests
ENTRYPOINT ["node", "src/runner.mjs"]
