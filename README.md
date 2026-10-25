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

The simulator is **calibrated, not copied**: [`tools/calibrate.py`](backend/tools/calibrate.py) measures aggregate patterns (pass length mix, failure rates near goal and when challenged, shot conversion by distance, header rates, duel, foul and card rates) from open event data and saves them to [`calibration.json`](backend/generator/calibration.json). A few things the data does not record (carries, how often players are pressed, shot technique, deflections, ball speed) are set by hand and listed under `assumptions` in that file. Every generated match is new, but averages line up with real football:

| Per match | Real (World Cup 2018 + Euro 2016) | Simulated (20 matches) |
|---|---|---|
| Passes | 863 | 977 |
| Pass accuracy | 85% | 85% |
| Shots | 22.8 | 22.5 |
| Goals | 1.9 | 2.1 |
| Ground duels (tackle attempts) | 126 | 137 |
| Fouls | 27 | 29 |

Scripted goals let a demo put key moments where they are wanted:

```bash
cd backend
python -m generator.match_sim --seed 7 --goal 23:home --goal 78:away:30 --out match.json
```

**Calibration data.** Aggregate statistics are computed from the public Wyscout soccer-logs dataset, World Cup 2018 and Euro 2016 only (no Premier League data), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

> Pappalardo, L., Cintia, P., Rossi, A. et al. A public data set of spatio-temporal match events in soccer competitions. *Scientific Data* 6, 236 (2019). https://doi.org/10.1038/s41597-019-0247-7 — data: https://figshare.com/collections/Soccer_match_event_dataset/4415000

No real match events are included in this repository; only derived averages are.

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
