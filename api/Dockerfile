# AMS API image. The same image runs the API, the Celery worker and Celery beat:
#   api:    (default CMD) alembic upgrade head, then uvicorn on :8000
#   worker: celery -A app.worker worker --loglevel=INFO
#   beat:   celery -A app.worker beat --loglevel=INFO --schedule /tmp/celerybeat-schedule
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    AMS_UPLOAD_DIR=/data/uploads

RUN pip install --no-cache-dir uv==0.11.32

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

RUN useradd --system --uid 10001 --home-dir /app ams \
    && mkdir -p /data/uploads \
    && chown -R ams /data
USER ams

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
