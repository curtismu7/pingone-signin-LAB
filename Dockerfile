# Build the web app, then run the API server, which also serves web/dist. Same pattern as the other labs.
# Node 26 only (rulebook). Docker on OrbStack, never Docker Desktop.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY core/package.json core/
COPY server/package.json server/
# npm reaches the registry over IPv6 first on the OrbStack network and times out; let Node fall back to IPv4 for the build.
ENV NODE_OPTIONS="--network-family-autoselection --network-family-autoselection-attempt-timeout=500"
# Only the web workspace's dependencies: the root devDependencies (Playwright, ajv) are not needed to build the UI.
RUN npm ci -w web
COPY web web
# The Talk track tab imports docs/talk-track.md as text.
COPY docs/talk-track.md docs/talk-track.md
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=6171
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY core/package.json core/
COPY server/package.json server/
ENV NODE_OPTIONS="--network-family-autoselection --network-family-autoselection-attempt-timeout=500"
RUN npm ci --omit=dev -w server -w core && npm cache clean --force
ENV NODE_OPTIONS=""
COPY core/src core/src
COPY server/src server/src
COPY server/data server/data
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 6171
# Inside the container the server must listen on all interfaces, so SIGNIN_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV SIGNIN_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
