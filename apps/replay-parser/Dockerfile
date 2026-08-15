# syntax=docker/dockerfile:1
# Internal-only replay parsing service -- see README.md. `daemon_core/` is
# `daemon-python/src` copied in verbatim (its `parser.py` has zero
# Windows-only dependencies -- those live in daemon-python's tray/OCR/hotkey
# modules, none of which this image copies or imports).
FROM python:3.12-slim
WORKDIR /app

# `git` is needed at build time only, to install heroprotocol straight from
# Blizzard's GitHub tag (see requirements.txt) -- not published on PyPI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY apps/replay-parser/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY daemon-python/src ./daemon_core
COPY apps/replay-parser/main.py ./

EXPOSE 8090
# Not bound to a public port anywhere in docker-compose.backend.yml -- reachable
# only by the `api` service, over the compose network, as http://replay-parser:8090.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
