# Models: what to run on the Hostinger KVM 8

**Server:** 8 vCPU · 32 GB RAM · 400 GB NVMe · **no GPU**. Everything below is CPU inference through Ollama.

## Recommended setup (default in `.env.example`)

| Role | Model | RAM | Speed on 8 vCPU (est.) | Used by |
| --- | --- | --- | --- | --- |
| **fast** | `qwen2.5:3b-instruct` | ~2.5 GB | ~18–25 tokens/s | Real-time comparison assistant, routing, SEO metadata, extraction, short posts |
| **writer** | `qwen2.5:7b-instruct` | ~5.5 GB | ~8–12 tokens/s | Persona rewriting, articles, multi-format content, custom prompts |
| **embed** | `nomic-embed-text` | ~0.3 GB | fast | Dedupe, similarity |
| **vision** (optional) | `moondream` | ~1.7 GB | ~5–15 s per image | Alt text and captions for the image agents. Set `MODEL_VISION=moondream`; without it, alt text comes from the page's own alt/caption and context |

All of them stay loaded together (`OLLAMA_MAX_LOADED_MODELS=4`, `OLLAMA_KEEP_ALIVE=24h`): about 9 GB of 32 GB (≈11 GB with the vision model). Nothing cold-starts, so the website assistant answers immediately.

**Why this split:**

- Visitors chatting on a client's site need answers in seconds. The 3B model starts streaming in under 1 s and finishes a comparison answer in about 5–10 s. The comparison table itself is computed exactly from the dataset (no model involved), so numbers in the table are never invented.
- Content quality matters more than speed for pipelines, and they run in the background. The 7B writer is the best quality-to-speed point on 8 CPU cores.
- `OLLAMA_NUM_PARALLEL=2` lets a chat request run while an article is being written, instead of waiting behind it.

> The speeds above are planning estimates for shared-vCPU VPS hardware. Measure the real numbers after setup and record them here:
> `docker compose -f docker-compose.yml exec api python /srv/layerflow/scripts/bench_model.py`

## Options

| Want | Change in `.env` | Trade-off |
| --- | --- | --- |
| Better writing | `MODEL_WRITER=qwen2.5:14b-instruct` (~9 GB) | About 2× slower (~4–6 tok/s). Good when pipelines run hourly or overnight |
| Newer model family | Try `qwen3:8b` as writer / `qwen3:4b` as fast | Benchmark first: reasoning models add "thinking" tokens. Keep whichever wins on your golden set |
| Hindi / regional languages | `qwen2.5:7b-instruct` handles Hindi reasonably; benchmark on real samples | Quality varies by language; keep human approval on |
| Lowest RAM | `MODEL_WRITER=qwen2.5:3b-instruct` | Weaker long-form prose |
| Much faster everything | GPU server running Ollama/vLLM, then `OLLAMA_BASE_URL=http://<gpu-host>:11434` (or `MODEL_PROVIDER=openai_compat`) | Extra cost; 5–10× faster |
| A premium client on a paid API | `MODEL_PROVIDER=openai_compat` + base URL + key | Per-token cost |

After changing models: `bash scripts/vps/pull-models.sh && docker compose -f docker-compose.yml up -d`.

## Capacity on KVM 8 (rough)

| Workload | Comfortable volume |
| --- | --- |
| Scraping + dataset updates | Thousands of pages/day (network-bound, polite rate limits) |
| Full story → article + 5 social formats | ~150–300/day with the 7B writer, one at a time |
| Assistant chats | ~5–10 concurrent visitors with the 3B model before replies queue |
| Clients (workspaces) | 10–20 typical clients; the model is the bottleneck, not the app |

Upgrade signals: run queue regularly > 30 min behind, or chat replies > 15 s. Then move to a bigger plan, add a GPU model host, or route heavy clients to an API model.
