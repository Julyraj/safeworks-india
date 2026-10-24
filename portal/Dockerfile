# SafeWorks Portal – one container for the API, the user portal, the admin console and the safety library.
# Build from the repository root (the build needs /data and the library files):
#   docker build -f portal/Dockerfile -t safeworks-portal .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY portal/package.json portal/package-lock.json portal/
COPY portal/server/package.json portal/server/
COPY portal/web/package.json portal/web/
RUN cd portal && npm ci
COPY data data
COPY index.html manifest.webmanifest sw.js ./
COPY icons icons
COPY portal/server portal/server
COPY portal/web portal/web
RUN cd portal && npm run build
RUN cd portal && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    UV_THREADPOOL_SIZE=8 \
    STORAGE_DIR=/data/storage \
    WEB_DIST=/app/portal/web/dist
WORKDIR /app
COPY --from=build /app/data data
COPY --from=build /app/portal/package.json portal/package.json
COPY --from=build /app/portal/node_modules portal/node_modules
COPY --from=build /app/portal/server portal/server
COPY --from=build /app/portal/web/dist portal/web/dist
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
VOLUME ["/data/storage"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/portal/server
CMD ["node", "dist/index.js"]
