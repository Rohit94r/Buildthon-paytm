# Run the dashboard without a backend (demo mode)

Use this to **show LayerFlow from any laptop** (e.g. a MacBook that can't run models) or to host a public demo. No Python, no database and no model are needed. The dashboard runs on built-in sample data for three clients:

| Workspace | What it shows |
| --- | --- |
| **MarketPulse News** | 7 agents (scraper → persona rewriter → multi-format → SEO → quality → auto-post), live pipeline runs, multi-format content |
| **CollegeCompass** | College dataset (sample data), data-collector pipelines, real-time comparison assistant |
| **The Executive Narrative** | The original newsroom module (feed, studio, review, SEO, calendar, social) |

Clicks work: creating agents, editing pipelines, **Run now** (steps animate), approving content and chatting with the assistant. Changes live in memory and reset on reload. Nothing is sent anywhere.

## On a Mac (first time)

```bash
# 1. Tools (skip what you already have)
xcode-select --install                    # git
brew install node@22 && npm i -g pnpm@10  # or download Node 22 LTS from nodejs.org

# 2. Code
git clone https://github.com/Rohit94r/Layerflow-agents.git
cd Layerflow-agents/apps/web
pnpm install

# 3. Run in demo mode
NEXT_PUBLIC_DEMO_MODE=true pnpm dev
# open http://localhost:3000
```

Or run `pnpm dev` without the variable and click **Explore the live demo** on the login page. That sets demo mode in the browser; **Exit demo** in the top banner turns it off.

For a faster, production-like demo:

```bash
NEXT_PUBLIC_DEMO_MODE=true pnpm build && pnpm start
```

## Host a public demo (optional)

Deploy `apps/web` to Vercel or Netlify with the environment variable `NEXT_PUBLIC_DEMO_MODE=true`. Vercel settings: root directory `apps/web`, framework *Next.js*, install command `pnpm install`. The demo never calls an API, so no backend URL is needed.

## Switching to the real backend

Leave `NEXT_PUBLIC_DEMO_MODE` unset (or `false`) and run the API (see [local-dev.md](./local-dev.md)), or use the VPS deployment. The same screens then show real data.
