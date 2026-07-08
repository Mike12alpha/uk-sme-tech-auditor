# Apify Actor Dockerfile for UK SME Tech Auditor
# Uses official Playwright + Chrome base image
FROM apify/actor-node-playwright-chrome:20

# Set working directory
WORKDIR /usr/src/app

# Ensure Lighthouse can find Chrome
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Wappalyzer bundles its own puppeteer, which by default downloads a second,
# separate copy of Chrome and reads CHROMIUM_BIN for its executable path.
# Point it at the Chrome already provided by the base image instead.
ENV CHROMIUM_BIN=/usr/bin/google-chrome-stable
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy package files and install dependencies (npm ci for reproducible builds)
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/cache/apk/*

# Copy actor source code
COPY . ./

# Run the actor
CMD ["node", "src/main.js"]
