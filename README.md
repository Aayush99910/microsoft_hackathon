# Match Brain

Multi-agent AI that turns synthetic football match events into explainable match intelligence, live commentary, recaps and personalized fan stories.

Built for the Microsoft x Premier League **Inside the Game: Developer Hackathon**.

> Uses synthetic, football-realistic data only. No real Premier League match data.

## Status

Work in progress.

## Project layout

```
backend/     FastAPI + Microsoft Agent Framework (Python 3.10+)
  app/         API
  generator/   synthetic match event generator
  agents/      Analyst, Explainer, Narrator, Recap, Personalizer
frontend/    React + TypeScript (Vite)
```

## Run locally

Backend (http://localhost:8000):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Frontend (http://localhost:5173, proxies `/api` to the backend):

```bash
cd frontend
npm install
npm run dev
```
