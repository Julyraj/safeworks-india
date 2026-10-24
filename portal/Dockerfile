# SafeWorks Portal – one container for the API (Python), the user portal, the admin console and the safety library.
# Build from the repository root (the build needs /data and the library files):
#   docker build -f portal/Dockerfile -t safeworks-portal .

# 1) Web screens (React) – Node is used only to build them, it is not in the final image.
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY portal/package.json portal/package-lock.json portal/
COPY portal/web/package.json portal/web/
RUN cd portal && npm ci
COPY data data
COPY index.html manifest.webmanifest sw.js ./
COPY icons icons
COPY files files
COPY portal/web portal/web
RUN cd portal && npm run build

# 2) API server (Python 3.12, FastAPI) serving the built screens.
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    PORT=8080 \
    WEB_CONCURRENCY=2 \
    STORAGE_DIR=/data/storage \
    DATA_DIR=/app/data \
    WEB_DIST=/app/portal/web/dist
WORKDIR /app
COPY portal/server/requirements.txt portal/server/requirements.txt
RUN pip install -r portal/server/requirements.txt
COPY data data
COPY portal/server portal/server
COPY --from=web /app/portal/web/dist portal/web/dist
RUN useradd --system --uid 10001 --home /app safeworks \
    && mkdir -p /data/storage && chown -R safeworks:safeworks /data
USER safeworks
VOLUME ["/data/storage"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8080'), timeout=4).status == 200 else 1)"
WORKDIR /app/portal/server
CMD ["sh", "scripts/start.sh"]
