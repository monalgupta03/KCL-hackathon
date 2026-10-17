1. From the terminal

2. Start the FastAPI backend from the virtual environment:

   cd backend
   . .venv/bin/activate
   python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

3. In a second terminal, serve the frontend from the project root:

   cd ..
   python3 -m http.server 5500 --bind 127.0.0.1

4. Open the app in your browser:

   http://127.0.0.1:5500/

5. Set the backend environment in backend/.env:

   GEMINI_API_KEY=your_key_here
   TIMESCALE_SERVICE_URL=your_tigerdata_postgres_url

Notes:
- The backend health endpoint is http://127.0.0.1:8000/health
- The scan endpoint is http://127.0.0.1:8000/scan
- Inventory is persisted through http://127.0.0.1:8000/inventory
- Do not commit backend/.env to GitHub

