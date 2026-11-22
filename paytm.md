# Paytm Buildathon — LiveDesk (Hinglish me poori kahani)

## 1. Maine kya banaya?

Maine **LayerFlow LiveDesk** banaya hai — ek live research workspace jo ek hi sawaal ka **fresh aur verified** jawab deta hai.

Simple bhasha me: user ek question likhta hai, aur mera product us question ko **dono sponsor APIs** ko ek saath bhejta hai:

- **SerpApi** → real-time structured results (Web, News, Jobs, Shopping, Maps, Scholar)
- **You.com** → live web par based **cited answer** (jiske saath source links hote hain)

Dono ka data ek hi screen par aa jata hai. User ko alag-alag tabs kholne ki zarurat nahi. Har claim ke saath source dikhta hai, isliye jawab “AI ne bola” nahi, balki “ye live source se aaya” hota hai.

Ye product existing **LayerFlow** platform ke upar banaya hai, jo pehle se hi multi-tenant agent platform hai (FastAPI + Next.js). Maine us platform me sponsor integrations, ek naya dashboard, naye agent kinds, aur ek seeded demo workspace add kiya.

---

## 2. Problem kya tha?

Students, researchers, founders aur news desks ko aksar aise sawaal hote hain jin ka jawab **aaj ka** hona chahiye.

Normal chatbot:
- sometimes purana data deta hai,
- citation nahi deta,
- source verify karne ke liye alag tabs kholne padte hain,
- aur research ko repeatable workflow me nahi badal pata.

LiveDesk is problem ko solve karta hai: **fresh data + citations + workspace workflow** — sab ek jagah.

---

## 3. Product exactly kya karta hai?

```
User ka question
      |
      v
POST /api/v1/livedesk/research
      |
      |--- asyncio.gather (parallel)
      |       |
      |       +--> SerpApi : google / news / jobs / shopping / maps / scholar
      |       |
      |       +--> You.com : /v1/answer  (answer + citations + web results)
      |
      v
Ek hi response:
  - You.com ka cited answer
  - numbered sources (clickable links)
  - SerpApi ke alag-alag engine cards
  - latency, provider, degraded status
```

Frontend me `/livedesk` page hai jahan:
- question type karte hain,
- engines toggle karte hain (Web, News, etc.),
- “Run research” dabate hain,
- answer aur sources turant dikhte hain.

Assistant me bhi ek **“Live sources”** toggle hai. Usko on karke koi bhi dataset question pucha jaye to answer ke saath fresh sponsor citations bhi aate hain.

---

## 4. Maine kaun-kaun si API use ki?

### A. Neon PostgreSQL (`DATABASE_URL`)

Ye meri database hai — tenants, agents, pipelines, datasets, runs, content sab yahin store hote hain.

Environment me maine URL ko **async driver** ke liye correct kiya:

```env
DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>/neondb?ssl=require
```

Original URL `postgresql://...?sslmode=require&channel_binding=require` tha. FastAPI async SQLAlchemy ko `postgresql+asyncpg://` chahiye, isliye maine driver add kiya aur SSL param ko asyncpg ke hisaab se `ssl=require` rakha.

Verify bhi kiya — Neon se connect hoke Postgres version aa gaya. Database working hai. ✅

### B. SerpApi

Package: `app/services/sponsor.py`

Use kiye gaye endpoints:

| Endpoint | Kaam |
| --- | --- |
| `GET https://serpapi.com/search.json` | Structured real-time search |
| `GET https://serpapi.com/extract` | Kisi result page ka text/markdown nikalna |

Engines jo support hain:

```text
google          → Web results
google_news     → News results
google_jobs     → Jobs results
google_shopping → Shopping results
google_maps     → Local/Places results
google_scholar  → Academic results
```

Har engine ka alag native response hota hai. Maine usse ek common `SearchHit` me normalize kiya:

```text
title, url, summary, source, published_at, position, engine, provider
```

Isse frontend ko har engine ka data ek hi format me milta hai.

### C. You.com

Package: same `app/services/sponsor.py`

Use kiye gaye endpoints:

| Endpoint | Kaam |
| --- | --- |
| `POST https://api.you.com/v1/search` | Live web results (Web Search API) |
| `POST https://api.you.com/v1/answer` | Cited answer (Answer API) |

Request me `X-API-Key` header hota hai. Answer API se jo `answer`, `citations[]` aur `results.web[]` aata hai, usko product me direct use kiya jata hai.

Agar key `api.you.com` par kaam na kare to client `https://ydc-index.io` bhi try karta hai. Isliye dono env names support hain:

```env
YOUCOM_API_KEY=...
YDC_API_KEY=...      # alias
```

### D. LayerFlow ke apne APIs

| Endpoint | Kaam |
| --- | --- |
| `GET /api/v1/livedesk/status` | keys configured hain ya nahi (key value nahi batata) |
| `POST /api/v1/livedesk/research` | dono sponsors ko parallel call karke combined result deta hai |
| `POST /api/v1/assistant/chat` | dataset Q&A + `live_sources: true` se cited answer |
| `GET/POST /api/v1/agents`, `/pipelines`, `/datasets` | seeded LiveDesk workspace |

---

## 5. Keys maine env me kaise daali?

File: **`apps/api/.env`** (ye git me commit nahi hoti, `.gitignore` me hai)

```env
DATABASE_URL=...              # Neon, asyncpg driver ke saath
SERPAPI_API_KEY=...           # primary name
SERPAPI_KEY=...               # alias (maine code me support add kiya)
YOUCOM_API_KEY=...            # primary name
YDC_API_KEY=...               # You.com ka alias
SERPAPI_BASE_URL=https://serpapi.com
YOUCOM_BASE_URL=https://api.you.com
SPONSOR_TIMEOUT_S=12
SPONSOR_CACHE_S=300
MODEL_PROVIDER=mock
DISABLE_AUTH=true
```

Important: **keys kisi bhi committed file me nahi hain.** Sirf local `.env` me hain. Code me sirf variable names hain, values nahi.

Maine `SERPAPI_KEY` alias bhi support karaya hai taaki aapne diya hua short name bhi directly kaam kare. Pehle sirf `SERPAPI_API_KEY` chal raha tha; ab dono chalte hain.

---

## 6. Live verification jo maine kiya

```text
Database connection   → PostgreSQL 18.7 connected ✅
SerpApi call          → provider = "serpapi", real result aaya ✅
You.com answer        → provider = "you.com", degraded = False, 2 citations ✅
Backend tests         → 142 passed ✅
Frontend typecheck    → clean ✅
Frontend build        → /livedesk route generate hua ✅
```

Matlab keys sirf file me nahi padhi hain — actual live calls bhi successfully chal chuki hain.

---

## 7. Maine kya-kya banaya (feature list)

- `/livedesk` dashboard with:
  - preset questions,
  - engine toggles,
  - results per engine,
  - You.com cited answer,
  - clickable numbered sources,
  - sample-data badges jab key na ho.
- `serpapi_search` agent kind — real SerpApi engines + Extract option + URL dedupe.
- `you_research` agent kind — `answer` aur `search` dono modes.
- 4 sponsor tools:
  - `serpapi.search`
  - `serpapi.extract`
  - `you.search`
  - `you.answer`
- Citation-aware assistant (`live_sources: true`).
- Seeded **LiveDesk** workspace:
  - Research Queue dataset,
  - 4 agents,
  - 1 manual pipeline.
- Frontend demo mode bhi hai — bina backend aur bina keys ke bhi sample data dikhata hai.
- Tests me fake HTTP transport hai, isliye test suite sponsor credits nahi kharch karta.

---

## 8. Inteji no. 1 — Mujhe kis baat pe garv hai?

Sabse achhi baat ye hai ki maine sponsor APIs ko **sirf UI me nahi chhupaya**. Unhe platform ke andar **first-class agents** banaya.

Matlab:
- SerpApi aur You.com ab do naye agent kinds hain,
- unke catalogue presets hain,
- pipeline me chal sakte hain,
- run logs me dikhte hain,
- aur assistant unke citations use kar sakta hai.

Ye sirf “API call dikhana” nahi, balki ek real workflow product hai.

Dusri baat — **honesty**. Agar key na ho ya network fail ho, to maine fake data ko “live” nahi bataya. Usme `provider="demo"` hota hai aur UI par clearly **sample** likha dikhta hai. Judges bina keys ke bhi demo chala sakte hain aur_confuse nahi honge.

---

## 9. Judging criteria se mapping

| Criterion | Mera jawaab |
| --- | --- |
| Working prototype / demo (30%) | `/livedesk` page, demo mode, seeded workspace, 142 tests, build pass |
| Sponsor integration (25%) | SerpApi 6 engines + Extract, You.com Search + Answer, 2 agent kinds, 4 tools |
| Real-world impact (20%) | Fresh, cited research for students/founders/desks — tab switching khatam |
| Innovation (15%) | Parallel fan-out + common evidence model + citations feed assistant bhi karte hain |

---

## 10. Demo kaise chalayein?

### Frontend-only (sabse jaldi)

```bash
cd apps/web
pnpm install
NEXT_PUBLIC_DEMO_MODE=true pnpm dev
```

Phir open karein: http://localhost:3000/livedesk

### Full stack (ab .env ready hai)

Terminal 1:

```bash
cd apps/api
python -m app.cli migrate
python -m app.cli seed-demo-platform
python -m uvicorn app.main:app --reload --port 8000
```

Terminal 2:

```bash
cd apps/web
pnpm dev
```

Open karein: http://localhost:3000/livedesk

Upar right me status pill dikhegi: **“Sponsor keys connected”**.

---

## 11. Chhota sa safety note ⚠️

Aapne keys chat me paste ki thi. Demo ke liye chal gayi, lekin aage ke liye best practice ye hai:

1. In keys ko abhi **rotate** kar dein (SerpApi aur You.com dono dashboard se nayi key banayein).
2. Nayi key sirf apne local `.env` me daalein.
3. `.env` ko kabhi commit ya share na karein.
4. GitHub repo me sirf `.env.example` rakha hai — usme values nahi, sirf names hain.

Extra SerpApi credits (buildathon ke liye):
- Mumbai: https://serpapi.com/beyond9to5mumbai500
- Bengaluru: https://serpapi.com/beyond9to5blr

---

**Bottom line:** LiveDesk ek working product hai jo SerpApi ki structured power aur You.com ki cited intelligence ko ek hi research workspace me laata hai — aur poora LayerFlow platform uske peeche milta hai. 🚀
