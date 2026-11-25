# TOTP test bench: a fake "2FA service" (stdlib-only Python). Every key it issues is fake and lives in memory.
# Build context is the repository root (the bench serves the QR library from extension/vendor):
#   docker build -f bench/Dockerfile -t authbackup-bench .
#   docker run --rm -p 8793:8080 authbackup-bench
FROM python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b

ENV HOST=0.0.0.0 PORT=8080 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --no-create-home --uid 10001 bench
WORKDIR /app
# server.py resolves ../extension/vendor relative to itself, so keep the same layout.
COPY bench/ /app/bench/
COPY extension/vendor/ /app/extension/vendor/
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request as u; u.urlopen('http://127.0.0.1:%s/healthz' % os.environ['PORT'], timeout=2)"]
CMD ["python", "/app/bench/server.py"]
