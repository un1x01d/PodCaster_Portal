# TFORN Insights

## AI Chat Configuration

The spreadsheet chatbot is model-backed and calls the backend `POST /chat/query` endpoint.

Set these backend environment variables:

- `AI_PROVIDER` (`openai`, `gemini`, or `ollama`; default: `openai`)
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` for GPT/OpenAI-compatible OpenAI usage
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` for Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`)
- `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` for Ollama (`http://localhost:11434/v1` locally, or `http://host.docker.internal:11434/v1` from Docker)
- `OPENAI_INPUT_COST_PER_1M` / `OPENAI_OUTPUT_COST_PER_1M`, `GEMINI_INPUT_COST_PER_1M` / `GEMINI_OUTPUT_COST_PER_1M`, and `OLLAMA_INPUT_COST_PER_1M` / `OLLAMA_OUTPUT_COST_PER_1M` seed the admin model cost defaults
- `OPENAI_TIMEOUT_MS` (default: `25000`)
- `CHAT_MAX_ROWS` (default: `50000`)
- `CHAT_SAMPLE_ROWS` (default: `120`)

The admin AI runtime panel can also switch the active provider, model, and base URL per saved runtime setting. Chat audio still uses OpenAI TTS, so keep `OPENAI_API_KEY` set if audio generation is enabled.

`docker-compose.yml` is wired to pass these values into the backend container.
