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

## Synthetic match data

`backend/generator/` simulates full 90-minute matches between fictional clubs as a stream of events (pass, carry, pressure, tackle, shot, goal, possession change, foul, card, period start/end). The schema and pitch coordinates are documented in [`events.py`](backend/generator/events.py).

The simulator is **calibrated, not copied**: [`tools/calibrate.py`](backend/tools/calibrate.py) measures aggregate patterns (pass length mix, failure rates under pressure and near goal, shot conversion by distance, foul and card rates) from open event data and saves them to [`calibration.json`](backend/generator/calibration.json). Every generated match is new, but averages line up with real football:

| Per match | Real (open data) | Simulated (20 matches) |
|---|---|---|
| Open-play passes | 900 | 988 |
| Pass accuracy | 82% | 82% |
| Shots | 25–27 | 28 |
| Goals | 2.7 | 3.0 |
| Tackles | 27 | 27 |
| Fouls | 30 | 32 |

Scripted goals let a demo put key moments where they are wanted:

```bash
cd backend
python -m generator.match_sim --seed 7 --goal 23:home --goal 78:away:30 --out match.json
```

Calibration source: [StatsBomb Open Data](https://github.com/statsbomb/open-data), used only to compute averages; no real match events are included in this repository.

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
