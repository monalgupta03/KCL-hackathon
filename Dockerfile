FROM python:3.12-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home appuser
COPY backend/*.py ./
USER appuser
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*", "--root-path", "/api"]

FROM caddy:2-alpine AS web
COPY index.html /srv/index.html
COPY js/ /srv/js/
COPY css/ /srv/css/
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# Rewrite only the deployed static copy. Local source URLs remain unchanged.
RUN sed -i 's|http://127.0.0.1:8000|/api|g' /srv/js/api.js /srv/js/add.js /srv/js/app.js
