# Apify Actor Dockerfile for Universal Lead Generator
# Uses official Playwright + Chrome base image (needed for the Google Maps source)
FROM apify/actor-node-playwright-chrome:20

WORKDIR /usr/src/app

# Copy package files and install dependencies (npm ci for reproducible builds)
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --omit=optional \
    && npm cache clean --force \
    && rm -rf /tmp/* /var/cache/apk/*

# Copy actor source code
COPY . ./

CMD ["node", "src/main.js"]
