FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY python/requirements-runtime.txt ./
RUN pip install --no-cache-dir -r requirements-runtime.txt \
    && useradd --no-create-home --uid 10001 --shell /usr/sbin/nologin engine

COPY --chown=engine:engine python/bridge_protocol.py ./
COPY --chown=engine:engine python/forex_ai_engine.py ./
COPY --chown=engine:engine python/healthcheck.py ./
COPY --chown=engine:engine python/mt5_tcp_bridge.py ./

USER engine

CMD ["python", "forex_ai_engine.py"]
