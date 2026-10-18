<div align="center">

# SavourIt

### Less food forgotten. Less time deciding. More meals from what you already have.

A fridge companion that helps you track groceries, spot what needs using soon, and turn your ingredients into your next meal.

**Vanilla JavaScript · FastAPI · TigerData PostgreSQL · Google Gemini**

**[Demo video - add link]** 

</div>

> **Hero image placeholder:** Add a desktop/mobile overview showing the pantry and Cook screens. Suggested file: `docs/images/savourit-overview.png`.

## The story

You open the fridge, see the same ingredients you bought a few days ago, and still ask: *What can I actually make?*

The spinach is somewhere behind the milk. You cannot remember when you bought the mushrooms. A recipe looks promising until you realise it needs ingredients you do not have. By the time you make a decision, ordering something feels easier.

SavourIt connects those disconnected decisions:

**What do I have? → What needs using first? → What can I cook with it?**

The idea is to reduce the effort between buying food and using it. Instead of maintaining a spreadsheet, checking every date, and searching through unrelated recipes, you get one place to add groceries, review freshness information, and find meals grounded in your pantry.

For the hackathon's **Max Ease** theme, our focus is practical: fewer things to remember, fewer repeated inputs, and a clearer next step when you open the app.

## A quick tour

### 1. Add groceries without starting from a blank list

Take a photo or upload a JPEG/PNG. Gemini identifies visible groceries and returns item names, quantities where clear, and expiry metadata in the same recognition request.

Review the results, correct names, quantities or units, and confirm the items you want to save. Uncertain quantities require your input. Manual entry is also available, with a single text-only freshness estimate when you submit without a date.

Groceries are saved through FastAPI to TigerData. Photo recognition does not automatically add an item before you review it.

> **Screenshot placeholder:** Add a photo recognition result with editable item fields and the confirmation button. Suggested file: `docs/images/add-and-review.png`.

### 2. See what needs your attention

The pantry shows quantities, units and dates, with groceries ordered by date and unknown dates placed last.

- **Edit** updates the name, quantity, unit and expiry date.
- Click an **Estimated** badge to open that item's existing editor with the date prefilled.
- Saving a date confirms it, even if you leave the date unchanged. An estimated date then displays **Confirmed**, and the confirmation survives refreshes.
- **Mark as Eaten** consumes the entire remaining quantity and removes the item from the active pantry.

Consumed groceries are not permanently deleted. Their records remain in TigerData with an `eaten` status, and an `EATEN` event records the negative remaining quantity for future analytics.

> **Screenshot placeholder:** Add the pantry, including an Estimated badge and the same item after confirmation. Suggested file: `docs/images/pantry-and-confirmation.png`.

### 3. Decide what to cook from your actual pantry

Choose **5, 15 or 30 minutes** and a dietary preference: no preference, vegetarian, vegan, dairy free or gluten free.

The backend loads active pantry ingredients and asks Gemini for two different recipes. Recommendations include quantities, cooking time, instructions, missing ingredients and a brief explanation of which freshness dates were prioritised.

Availability is checked by the application, not accepted on the model's word. If a recipe needs more than you have, the missing quantity is shown. Recipes are alternatives; the pantry does not need to cover both meals at once.

Open a card for instructions, or reject a meal to request different suggestions. Opening recipe details does not make another Gemini request.

> **Screenshot placeholder:** Add two recipe cards with the time filter, dietary preference and source labels visible. Suggested file: `docs/images/cook-recommendations.png`.
>
> **Screenshot placeholder:** Add a recipe detail screen with ingredient quantities and instructions. Suggested file: `docs/images/recipe-details.png`.

### 4. Keep prepared food in view

Track leftovers with quantities, preparation time and storage location. Leftovers can be edited, removed or marked eaten.

**Leftovers are stored on the current browser, not in TigerData.** This is labelled in the interface. After cooking a recipe, use pantry Edit or Mark as Eaten to update ingredients; recipe viewing does not automatically deduct stock.

## What makes it useful

| Everyday friction | SavourIt's approach |
| --- | --- |
| Re-entering every grocery from scratch | Photo recognition followed by human review, plus manual entry. |
| Forgetting what is in the fridge | A persistent grocery inventory with quantities and units. |
| Not knowing what to use first | Date-based ordering, attention labels and an editable freshness date. |
| Searching recipes unrelated to your groceries | Pantry-aware suggestions with quantity checks and visible shortages. |
| Opening a recipe that takes too long | A preparation-time limit passed to the backend and validated on the response. |
| Losing trust when an AI service fails | Explicitly labelled, pantry-matched demo recipes instead of fabricated AI success. |

## Where AI is used

### AI inside the product

Gemini is called from the backend. API keys are never sent to the frontend.

| Feature | Information sent to Gemini | What the application does with the response |
| --- | --- | --- |
| Grocery recognition | The submitted image and a recognition prompt. | Validates and normalises item metadata, then asks the user to review it before saving. |
| Manual freshness estimation | The food name and today's date. | Accepts a valid estimated calendar date or saves unknown expiry if estimation fails. |
| Meal recommendations | Eligible pantry names, quantities, units, dates, date sources, confirmation flags, time limit, dietary restrictions and rejected meal titles. | Validates the recipe structure, checks stock quantities, flags missing ingredients and ranks suggestions by the dates of ingredients used. |

The current default model is `gemini-3.8-flash`; it can be overridden with the backend `GEMINI_MODEL` environment variable.

**AI does not decide whether food is safe.** A model estimate is freshness guidance, not a verified use-by date. Confirming an estimate records a user's review; its original `estimated` source remains stored internally.

The backend conservatively excludes past-dated items from meal recommendations, including past estimates. Unknown and estimated dates require a freshness check. Obvious conflicts with supported dietary preferences are rejected, but the app does not certify allergy safety or replace checking food labels.


### AI used while building the project

AI assistance was used during development and is disclosed separately from the runtime Gemini features.

| Tool | Development contribution |
| --- | --- |
| **GitHub Copilot** | Assisted the earlier implementation of expiry estimation, recognition expiry metadata, TigerData expiry persistence, confirmation behavior and urgency/sorting. |
| **Gemini & OpenAI Codex** | Assisted verification and debugging, meal API implementation and frontend integration, deterministic fallback logic, request caching and race fixes, UI polish, regression tests, deployment scaffolding and this README draft. |

The rules, quantity checks, confirmation state, event recording and fallback selection are explicit application code; they are not decisions delegated entirely to an LLM.

The current UI uses CSS and Unicode emoji.

## Architecture

The project deliberately keeps the stack small: a static frontend, one FastAPI service, an existing PostgreSQL database, and Gemini for the tasks that benefit from model inference.

```mermaid
flowchart LR
    User[User] --> UI[Static HTML / CSS / JavaScript]
    UI --> API[FastAPI]
    API --> DB[(TigerData PostgreSQL)]
    API --> Gemini[Google Gemini API]
    API --> Demo[Deterministic meal fallback]
    UI --> Local[(Browser storage: leftovers)]
```

### Data and responsibility boundaries

- **Frontend:** navigation, review forms, date display, user feedback and recipe rendering.
- **FastAPI:** validation, image checks, AI prompts and schemas, stock checks and database operations.
- **TigerData:** active/consumed grocery records and inventory events.
- **Browser storage:** leftovers. Cached recipe results are held in memory and reset when the page reloads.
- **Gemini:** recognition, optional freshness estimates and recipe generation. It is not the inventory source of truth.

### Expiry metadata

| Field | Purpose |
| --- | --- |
| `expiry_date` | The stored date, or `null` if unknown. |
| `expiry_date_source` | `printed`, `estimated` or `unknown`. |
| `expiry_date_confirmed` | Whether the user has reviewed/confirmed the date. |
| `status` | `active` or `eaten`; consumed rows are preserved. |

### Keeping interactions responsive

- Concurrent pantry reads share a request; writes invalidate older reads so stale data cannot replace freshly saved items.
- Equivalent in-flight meal requests are shared. Recently fetched meals are cached for the same pantry, preferences, rejected meals and calendar day.
- Gemini results are cached for up to five minutes; demo results for up to one minute.
- Duplicate submissions are guarded, and late responses cannot overwrite a newer screen.
- Gemini calls have bounded timeouts and SDK retries disabled. A scan does not trigger a second Gemini call just to estimate expiry.

## Repository structure

```text
.
├── index.html                  # App entry point and navigation shell
├── css/
│   └── style.css               # Shared styling and responsive layouts
├── js/
│   ├── app.js                  # Routing, delegated actions and form handling
│   ├── api.js                  # FastAPI requests and response mapping
│   ├── add.js                  # Manual entry, camera/upload and scan review
│   ├── fridge.js               # Pantry, expiry labels/editing and leftovers
│   ├── cook.js                 # Time/diet filters, meal cache, cards and 
├── backend/
│   ├── main.py                 # FastAPI routes, validation, Gemini and PostgreSQL
│   ├── demo_meals.py           # Pantry-matched fallback recipes and diet checks
│   ├── requirements.txt        # Python dependencies
│   └── .env.example            # Backend configuration template, no real secrets
├── tests/
│   ├── test_expiry.py          # Inventory, expiry confirmation and Eaten API tests
│   ├── test_meals.py           # Meal validation, priority and availability tests
│   ├── test_demo_meals.py      # Deterministic fallback feasibility tests
│   ├── test_gemini_requests.py # Actual SDK serialization with mocked HTTP
│   ├── test_product_audit.py   # Quantity, localhost CORS and timeout checks
│   ├── expiry_frontend.cjs     # Frontend expiry/inventory flow tests
│   ├── cook_flow.cjs           # Cook flow through mocked FastAPI responses
│   ├── cook_bridge.py          # Test-only API bridge with mocked database/Gemini
│   └── product_audit.cjs       # Interaction, storage and request-race regressions
├── Dockerfile                  # Optional backend/static-web container builds
├── compose.yaml                # Optional single-VM deployment
├── .dockerignore               # Excludes secrets and local environments
├── deploy.env.example          # Optional deployment environment template
├── deploy/
│   ├── Caddyfile               # HTTPS, proxy and shared demo login
│   └── README.md               # Exact Vultr deployment instructions
├── README.txt                  # Earlier local startup notes
└── README.md                   # This project guide
```

You may see `FridgeFlow` in an older working-directory name or browser storage keys. Those internal names are retained to avoid disrupting existing local data.

## Run locally

### Prerequisites

- Python 3.12 or later.
- Access to an existing TigerData PostgreSQL database.
- A Gemini API key for live AI features.
- Node.js 20 or later if you want to run the frontend tests. The frontend itself has no npm build step.

### 1. Get the code and install backend dependencies

```sh
git clone https://github.com/monalgupta03/KCL-hackathon.git
cd KCL-hackathon
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

If you already have the project locally, use its existing root folder instead of cloning again.

### 2. Configure the backend

Create `backend/.env` from `backend/.env.example` if it does not already exist. Keep an existing environment file intact.

```dotenv
GEMINI_API_KEY='YOUR_GEMINI_API_KEY'
TIMESCALE_SERVICE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require'
# Optional model override:
GEMINI_MODEL='gemini-3.8-flash'
```

| Variable | Required? | Notes |
| --- | --- | --- |
| `TIMESCALE_SERVICE_URL` | Yes, for persisted groceries and pantry-based meals. | Use the existing TigerData connection string and its required SSL settings. |
| `GEMINI_API_KEY` | For live recognition, estimation and generated meals. | Without it, manual groceries can retain unknown dates and Cook can use labelled demo recipes. |
| `GEMINI_MODEL` | No. | Defaults to `gemini-3.8-flash`. |

The existing inventory endpoints create/migrate their tables when accessed. The database role therefore needs the corresponding table creation/ALTER permissions, as well as normal read/write access. Confirm the database and role before connecting a fresh environment.

Never commit `backend/.env` or put an API key in browser JavaScript. The repository's ignore files exclude real environment files.

### 3. Start FastAPI

From the project root:

```sh
backend/.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

### 4. Serve the frontend

In a second terminal, from the same project root:

```sh
python3 -m http.server 5500 --bind 127.0.0.1
```

Open **http://127.0.0.1:5500/**. Use a local HTTP server rather than opening `index.html` directly. Camera access requires localhost or HTTPS and browser permission.

The backend is at `http://127.0.0.1:8000`. The app allows the documented frontend origins `http://127.0.0.1:5500` and `http://localhost:5500`.

Check backend health without calling Gemini:

```sh
curl http://127.0.0.1:8000/health
```

Expected response: `{"status":"ok"}`. This confirms the API process is reachable; it is not a database or Gemini health check.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | API process health. |
| `GET` | `/inventory` | Active groceries with quantities and expiry metadata. |
| `POST` | `/inventory` | Save a grocery and record an `ADD` event. |
| `PATCH` | `/inventory/{item_id}` | Edit the item; saving a nonempty date confirms it. |
| `PATCH` | `/inventory/{item_id}/expiry` | Confirm/edit only the expiry date. |
| `POST` | `/inventory/{item_id}/eaten` | Mark the full remaining quantity eaten and record an `EATEN` event. |
| `POST` | `/inventory/estimate-expiry` | Optional text-only freshness estimate. |
| `POST` | `/scan` | Recognise groceries from a JPEG/PNG upload, up to 5 MB. |
| `POST` | `/meals/recommend` | Generate and validate pantry-aware meals or return a labelled fallback. |

Interactive API documentation is available locally at **http://127.0.0.1:8000/docs**. Executing AI endpoints there can make real Gemini requests.

## Testing

Run backend tests from the project root:

```sh
backend/.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Run frontend tests:

```sh
node --test tests/expiry_frontend.cjs tests/cook_flow.cjs tests/product_audit.cjs
```

The automated tests mock Gemini and database access. SDK serialization tests use mocked HTTP transport, so they exercise the request format without contacting Google. They do not mutate real TigerData inventory.

Coverage includes recognition metadata, quota/provider failures, unknown-date saves, unchanged-date confirmation, refresh persistence, Eaten history, quantity validation, stock shortages, dietary checks, 5/15/30-minute meal flows, duplicate submissions, stale responses and browser-storage failures.

A separate headless-browser audit exercised desktop/mobile layouts, photo upload/review, manual Add, pantry editing/Eaten, recipe details and leftovers against a mocked server. Physical camera permission and live provider availability still depend on the demonstration environment.

## Suggested demonstration

1. Open Pantry and show which ingredients need attention first.
2. Add an item manually, or upload a photo when live recognition is available. Review before saving.
3. Click an Estimated badge, save the date unchanged and refresh to show Confirmed persists.
4. Open Cook, choose a time limit and dietary preference, then show the recommendation source label, quantities and instructions.
5. If Gemini is unavailable, explain that the labelled demo recipes still use actual pantry quantities and preferences.
6. Mark only a disposable test grocery as eaten and show that it leaves the active pantry.
7. Add a leftover and explain that it is stored on this browser.

> **Demo video placeholder:** Add a short recording of this journey and replace the link at the top of this README.

## Current scope and honest limitations

- **Live Gemini availability:** the latest single live verification returned HTTP 503 `UNAVAILABLE` with a provider high-demand message. Successful recognition and recipe-response paths are tested with mocks; this README does not claim a successful live AI demo. An earlier HTTP 400 could not be traced because its diagnostic did not retain the response body. Provider errors are now logged with the configured API key redacted.
- **Smart Fridge:** the Add screen includes the original Smart Fridge concept card. Its Sync button currently checks backend health. It does not connect to physical fridge hardware or automatically detect new groceries.
- **Leftovers:** browser-local, without cross-device sync.
- **Cooking:** does not automatically deduct recipe ingredients. Use pantry Edit or Mark as Eaten to record what was used.
- **Quantity matching:** conservative matching by ingredient name and unit. Arbitrary pack sizes, aliases and weight/volume conversions are not inferred for Gemini meal stock checks; the fallback supports a limited explicit set of food/unit aliases.
- **Authentication:** there are no application user accounts or per-user pantries. Use the app locally or privately; the optional deployment configuration adds a shared demo login at the proxy.
- **History:** inventory events are preserved for future analytics. An analytics dashboard is not implemented.
- **Food safety:** model estimates, visual recognition and user confirmations are not food-safety guarantees. Check packaging, storage conditions and relevant dietary/allergen information yourself.

## Deployment

A minimal optional Vultr setup is prepared in **[deploy/README.md](deploy/README.md)**: one VM, FastAPI and Caddy containers, HTTPS and the existing external TigerData database.

Deployment has not been performed as part of this work. No paid infrastructure was provisioned. Localhost development remains the default.

## What we would build next

- A real fridge-device integration behind the existing Smart Fridge concept.
- Server-side leftovers and authenticated, separate household inventories.
- Transactional recipe consumption with reviewable ingredient deductions.
- More robust unit handling and ingredient-name normalisation.
- A history view and waste-reduction analytics based on recorded inventory events.

These are next steps, not features claimed by the current prototype.

## Team and credits

- **Team/project author:** [Add names and GitHub profiles]
- **Roles and contributions:** [Add who owned product, frontend, backend, testing and presentation]
- **Demo and submission links:** [Add final links]
- **Additional assets or third-party code credits:** [Add any credits not already covered by the dependency list and AI disclosure]

The stack uses FastAPI, Uvicorn, Pydantic, psycopg, Pillow, Google Gen AI SDK and PostgreSQL through TigerData. Development assistance is disclosed above. Add a project license before presenting this repository as licensed for reuse.

---

**SavourIt helps answer one everyday question: what should I use next?**
