FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential curl libpq-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Drop the build toolchain after dependencies are installed so the
# runtime image doesn't ship a compiler. ``libpq5`` keeps psycopg2/asyncpg
# working at runtime.
RUN apt-get purge -y --auto-remove build-essential \
 && apt-get update && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/*

COPY . .

# Run as a dedicated non-root user. Only the application directory is
# writable so a compromised process cannot tamper with system paths or
# pip-installed packages.
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --home-dir /app --no-create-home app \
 && chown -R app:app /app
USER app

EXPOSE 8000

# Run Alembic migrations, then start the API server.
# Force --loop asyncio: the databento Live client is incompatible with uvloop's
# transport implementation (raises "Connection does not support read-write
# operations" inside connection_made). Plain asyncio works fine.
# --proxy-headers + --forwarded-allow-ips trust X-Forwarded-* from the
# Cloudflare tunnel / reverse proxy so client IPs and HTTPS scheme are
# correct in logs and rate-limit buckets without exposing the app to
# spoofed headers from arbitrary callers.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --loop asyncio --proxy-headers --forwarded-allow-ips=${FORWARDED_ALLOW_IPS:-127.0.0.1}"]
