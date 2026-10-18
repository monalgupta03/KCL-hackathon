<div align="center">

# SavourIt

### Use what you have. Waste less.

**Vanilla JavaScript · FastAPI · TigerData PostgreSQL · Google Gemini**

**[Demo video - add link]** 

</div>

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

## What we built and how AI helped

**Our work:** We chose food waste as the problem to tackle, sketched the screens and user journey, and defined the priorities: knowing what is in the fridge, using food before it is forgotten, and finding meals from those ingredients. We guided the implementation through design feedback, feature decisions and reviewing the app's behavior.

<!-- Replace the placeholder above with two inline image tags, each width="300", once the sketch files are added. -->

**AI-assisted development:** GitHub Copilot helped implement the initial expiry estimation, recognition metadata and database persistence. Gemini and OpenAI Codex helped with backend/frontend integration, debugging, meal recommendations, fallback logic, UI polish, automated tests and documentation. AI contributed implementation code; the product direction and sketches came from us.

**AI in the app:** Gemini recognises groceries in photos, suggests freshness dates and generates recipes using pantry ingredients, time limits and dietary preferences. Application code checks quantities and responses before displaying results. If Gemini is unavailable, predefined pantry-matched recipes are labelled **Demo mode**. Estimated dates remain guidance, not food-safety guarantees.

## Architecture

![SavourIt architecture](assets/Architecture.jpeg)

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

### Run locally

Requires Python 3.12+, TigerData PostgreSQL and a Gemini key for live AI. Node.js 20+ is only needed for frontend tests.

**Install:** Run from the project root.

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

**Configure:** Create `backend/.env` using `.env.example`. Preserve existing credentials and never commit this file.

```dotenv
GEMINI_API_KEY='YOUR_GEMINI_API_KEY'
TIMESCALE_SERVICE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
GEMINI_MODEL='gemini-3.8-flash' # Optional; this is the default
```

The database role needs read/write and table creation/ALTER permissions.

**Backend:** Run from the project root.

```sh
backend/.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

**Frontend:** Run in a second terminal from the project root.

```sh
python3 -m http.server 5500 --bind 127.0.0.1
```

**Open:** http://127.0.0.1:5500/ - camera access needs permission and localhost or HTTPS. **API docs:** http://127.0.0.1:8000/docs. **Health:** http://127.0.0.1:8000/health checks the API process only.

## Tests

Run from the project root:

```sh
backend/.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/expiry_frontend.cjs tests/cook_flow.cjs tests/product_audit.cjs
```

Tests use mocked Gemini and database responses to cover inventory, expiry confirmation, meal filters and failures without altering real pantry data.
