# Apify Actor Dockerfile for UK SME Tech Auditor
# Uses official Playwright + Chrome base image
FROM apify/actor-node-playwright-chrome:20

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies (npm ci for reproducible builds)
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/cache/apk/*

# Ensure Lighthouse can find Chrome
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copy actor source code
COPY . ./

# Run the actor
CMD ["node", "src/main.js"]
