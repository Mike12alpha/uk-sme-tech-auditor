# Apify Actor Dockerfile for Universal Lead Generator
# All sources are plain HTTP (Cheerio) or delegate to other Apify Actors
# (Google Maps) - no local browser needed, so a plain Node image is enough.
FROM apify/actor-node:20

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
