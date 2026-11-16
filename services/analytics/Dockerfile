FROM python:3.12-slim AS build
WORKDIR /app
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"
COPY services/analytics/requirements.txt ./
RUN pip install --no-cache-dir --retries 10 --timeout 60 -r requirements.txt

FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PATH="/venv/bin:$PATH" PYTHONUNBUFFERED=1
COPY --from=build /venv /venv
COPY services/analytics/app ./app
RUN useradd --system --no-create-home app
USER app
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
