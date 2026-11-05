# Tarragon Health upload scanner (decision T2-08): ClamAV daemon + freshclam + a small FastAPI front, in one container.
# Python 3.12, uv-managed. Multi-stage like services/ml: build a locked venv, then copy it into the runtime image.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-install-project --no-dev
COPY app ./app
RUN uv sync --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# clamav-daemon = clamd, clamav-freshclam = signature updater. Debian's packages track the upstream LTS line and get security
# updates through the normal apt channel; rebuild the image to pick them up.
RUN apt-get update \
 && apt-get install -y --no-install-recommends clamav-daemon clamav-freshclam ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/clamav /run/clamav \
 && chown -R clamav:clamav /var/lib/clamav /run/clamav

COPY docker/clamd.conf /etc/clamav/clamd.conf
COPY docker/freshclam.conf /etc/clamav/freshclam.conf
COPY docker/entrypoint.sh /usr/local/bin/scanner-entrypoint
RUN chmod 0755 /usr/local/bin/scanner-entrypoint

# Bake a signature set into the image so a cold start can scan even if the update mirror is slow or refuses us; the entrypoint
# still updates on start and freshclam keeps updating while the container runs. "|| true": a build must not fail because the
# mirror rate-limited the builder (the entrypoint then fetches on first start).
USER clamav
RUN freshclam --config-file=/etc/clamav/freshclam.conf --stdout || true
USER root

WORKDIR /app
COPY --from=builder --chown=clamav:clamav /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    ENVIRONMENT=production \
    CLAMD_HOST=127.0.0.1 \
    CLAMD_PORT=3310

# Everything runs as the unprivileged clamav user created by the Debian package.
USER clamav

EXPOSE 8000
# /ready is 503 until clamd answers PING (the signature database takes 30-90 s to load).
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD ["python", "-c", "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/ready' % os.environ.get('PORT','8000')).status==200 else 1)"]

CMD ["/usr/local/bin/scanner-entrypoint"]
