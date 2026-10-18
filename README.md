<div align="center">

# SavourIt

### Use what you have. Waste less.

A fridge companion built to reduce food waste by helping you use the groceries you already have.

**Vanilla JavaScript · FastAPI · TigerData PostgreSQL · Google Gemini**

**[Demo video - add link]** 

</div>

> **Hero image placeholder:** Add a desktop/mobile overview showing the pantry and Cook screens.

## The story

You open the fridge, see the same ingredients you bought a few days ago, and still ask: *What can I actually make?*

The spinach is somewhere behind the milk. You cannot remember when you bought the mushrooms. A recipe looks promising until you realise it needs ingredients you do not have. Ordering something feels easier, and the food you already bought stays forgotten.

SavourIt's goal is simple: **help food get eaten before it goes to waste.** It brings your groceries, freshness dates and meal ideas together, making it easier to answer:

**What do I have? → What needs using first? → What can I cook with it?**

That is our approach to **Max Ease**: make everyday food decisions easier so less food is wasted.

## A quick tour

### 1. Add groceries and use food before it is forgotten

Take a photo, upload a JPEG/PNG, or enter groceries manually. Review recognised names, quantities and expiry information before saving to TigerData. Manual entry can request a freshness estimate when you leave the date blank.

The pantry sorts groceries by date, with unknown dates last. **Edit** updates item details; clicking **Estimated** opens the same editor. Saving changes the badge to **Confirmed**, even if the date stays the same. **Mark as Eaten** removes the remaining quantity from the active pantry while preserving the record and an `EATEN` event.

<p align="center">
  <img src="assets/1.jpeg" alt="SavourIt Add groceries page" width="300">&nbsp;
  <img src="assets/2.jpeg" alt="SavourIt pantry showing saved groceries" width="300">
</p>

### 2. Cook from your pantry and remember leftovers

Choose **5, 15 or 30 minutes** and a dietary preference. Recipes prioritise earlier freshness dates and include quantities, instructions and any missing ingredients. Open a card for details or reject a meal for different suggestions.

Track leftovers with quantities, preparation times and storage locations. **Leftovers are saved on this browser only.** After cooking, update ingredients through pantry Edit or Mark as Eaten; recipes do not automatically deduct stock.

<p align="center">
  <img src="assets/3.jpeg" alt="SavourIt app screenshot 3" width="300">&nbsp;
  <img src="assets/4.jpeg" alt="SavourIt app screenshot 4" width="300">
</p>

## Where AI is used

Gemini runs in the backend; API keys stay out of the frontend.

| Feature | Information sent to Gemini |
| --- | --- |
| Grocery recognition | The uploaded photo and recognition prompt. |
| Freshness estimation | The food name and today's date. |
| Meal recommendations | Pantry ingredients, quantities, dates, time limit, dietary preferences and rejected meals. |

The backend validates responses, checks stock quantities and obvious dietary conflicts, and excludes past-dated items from meals. If Gemini fails, Cook can show clearly labelled **Demo mode** recipes matched to actual pantry quantities and preferences, rather than invented AI results.

**Estimated dates are guidance, not food-safety guarantees.** Confirmation preserves the original source internally. Check food condition, packaging and allergen information before use.

### AI used while building the project

AI assistance was used for development as well as the runtime Gemini features above.

| Tool | Development contribution |
| --- | --- |
| **GitHub Copilot** | Assisted the earlier implementation of expiry estimation, recognition expiry metadata, TigerData expiry persistence, date confirmation and urgency/sorting. |
| **Gemini & OpenAI Codex** | Assisted verification and debugging, pantry Edit/Eaten persistence, the meal API and frontend integration, deterministic fallback logic, request caching and race fixes, UI polish, regression tests, deployment scaffolding and this README draft. |
| **Project author/team** | Directed the problem, product requirements, feature priorities and design feedback, and reviewed app behavior and submission decisions. |

AI-assisted code spans `backend/`, `js/`, `css/`, `tests/` and the optional deployment configuration. Inventory rules, stock checks, confirmation state and event recording are explicit application code, rather than decisions left entirely to an LLM. The interface uses CSS and Unicode emoji.

## Architecture

```mermaid
flowchart LR
    UI[HTML / CSS / JavaScript] --> API[FastAPI]
    API --> DB[(TigerData PostgreSQL)]
    API --> Gemini[Google Gemini API]
    API --> Demo[Meal fallback]
    UI --> Local[(Browser storage: leftovers)]
```

## Project structure

```text
.
├── index.html              # App entry point
├── css/style.css           # Styling and responsive layouts
├── js/
│   ├── app.js              # Navigation and user actions
│   ├── api.js              # Backend requests
│   ├── add.js              # Manual entry, camera/upload and review
│   ├── fridge.js           # Pantry, expiry editing and leftovers
│   ├── cook.js             # Meal filters, cards and instructions
│   └── data.js             # Browser storage and local helpers
├── backend/
│   ├── main.py             # FastAPI, Gemini and database operations
│   ├── demo_meals.py       # Pantry-matched fallback recipes
│   ├── requirements.txt    # Python dependencies
│   └── .env.example        # Configuration template
├── tests/                  # Backend and frontend regression tests
└── README.md
```

## Run locally

You need **Python 3.12+**, an existing **TigerData PostgreSQL** database, and a **Gemini API key** for live AI features. Node.js 20+ is only needed for frontend tests; there is no npm build step.

### 1. Install dependencies

From the project root:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

### 2. Configure the backend

Create `backend/.env` from the example without overwriting existing credentials. Never commit this file.

```dotenv
GEMINI_API_KEY='YOUR_GEMINI_API_KEY'
TIMESCALE_SERVICE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
# Optional:
GEMINI_MODEL='gemini-3.8-flash'
```

The database role needs read/write and table creation/ALTER permissions. `GEMINI_MODEL` is optional and defaults to the value shown above.

### 3. Start the app

Backend, from the project root:

```sh
backend/.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

Frontend, in another terminal from the same directory:

```sh
python3 -m http.server 5500 --bind 127.0.0.1
```

Open **http://127.0.0.1:5500/**. Camera access needs browser permission and localhost or HTTPS.

- **API health:** http://127.0.0.1:8000/health - checks the API process, not Gemini or the database.
- **Interactive API docs:** http://127.0.0.1:8000/docs - executing AI endpoints can make live requests.

## Tests

Run from the project root:

```sh
backend/.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/expiry_frontend.cjs tests/cook_flow.cjs tests/product_audit.cjs
```

Tests use mocked Gemini and database responses to cover inventory, expiry confirmation, meal filters and failures without altering real pantry data.
