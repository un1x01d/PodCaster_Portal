# Data Insights Portal

## AI Chat Configuration

The spreadsheet chatbot is model-backed and calls the backend `POST /chat/query` endpoint.

Set these backend environment variables:

- `OPENAI_API_KEY` (required for AI chat)
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- `OPENAI_BASE_URL` (default: `https://api.openai.com/v1`)
- `OPENAI_TIMEOUT_MS` (default: `25000`)
- `CHAT_MAX_ROWS` (default: `50000`)
- `CHAT_SAMPLE_ROWS` (default: `120`)

`docker-compose.yml` is wired to pass these values into the backend container.
