"""Clubs and squads: real Premier League club names, made-up players (no real people)."""

import random

from .events import Player, Team

# Every team has the same 11 roles internally (the simulator's logic uses them: the ST kicks off,
# the GK saves, ...). A formation says where each role stands and what it is called on the team
# sheet. Spots are in the team's own attacking frame (as if attacking toward x=105): x = metres
# from their own goal line; y = metres across, where low y is the team's right-hand side.
# role -> (position label, line, x, y)
FORMATIONS: dict[str, dict[str, tuple[str, str, float, float]]] = {
    "4-3-3": {
        "GK": ("GK", "GK", 5, 34),
        "RB": ("RB", "DEF", 30, 8), "RCB": ("RCB", "DEF", 22, 24), "LCB": ("LCB", "DEF", 22, 44), "LB": ("LB", "DEF", 30, 60),
        "RCM": ("RCM", "MID", 45, 22), "CM": ("CM", "MID", 40, 34), "LCM": ("LCM", "MID", 45, 46),
        "RW": ("RW", "FWD", 72, 10), "ST": ("ST", "FWD", 78, 34), "LW": ("LW", "FWD", 72, 58),
    },
    "4-4-2": {
        "GK": ("GK", "GK", 5, 34),
        "RB": ("RB", "DEF", 30, 8), "RCB": ("RCB", "DEF", 22, 24), "LCB": ("LCB", "DEF", 22, 44), "LB": ("LB", "DEF", 30, 60),
        "RW": ("RM", "MID", 56, 9), "RCM": ("RCM", "MID", 44, 26), "LCM": ("LCM", "MID", 44, 42), "LW": ("LM", "MID", 56, 59),
        "CM": ("RS", "FWD", 76, 28), "ST": ("LS", "FWD", 76, 40),
    },
    "4-2-3-1": {
        "GK": ("GK", "GK", 5, 34),
        "RB": ("RB", "DEF", 30, 8), "RCB": ("RCB", "DEF", 22, 24), "LCB": ("LCB", "DEF", 22, 44), "LB": ("LB", "DEF", 30, 60),
        "RCM": ("RDM", "MID", 38, 26), "LCM": ("LDM", "MID", 38, 42),
        "RW": ("RAM", "MID", 64, 11), "CM": ("CAM", "MID", 60, 34), "LW": ("LAM", "MID", 64, 57),
        "ST": ("ST", "FWD", 80, 34),
    },
    "3-5-2": {
        "GK": ("GK", "GK", 5, 34),
        "RCB": ("RCB", "DEF", 22, 18), "CM": ("CB", "DEF", 18, 34), "LCB": ("LCB", "DEF", 22, 50),
        "RB": ("RWB", "MID", 46, 7), "RCM": ("RCM", "MID", 46, 24), "RW": ("CDM", "MID", 36, 34),
        "LCM": ("LCM", "MID", 46, 44), "LB": ("LWB", "MID", 46, 61),
        "ST": ("RS", "FWD", 76, 28), "LW": ("LS", "FWD", 76, 40),
    },
    "3-4-3": {
        "GK": ("GK", "GK", 5, 34),
        "RCB": ("RCB", "DEF", 22, 18), "CM": ("CB", "DEF", 18, 34), "LCB": ("LCB", "DEF", 22, 50),
        "RB": ("RWB", "MID", 44, 7), "RCM": ("RCM", "MID", 42, 26), "LCM": ("LCM", "MID", 42, 42), "LB": ("LWB", "MID", 44, 61),
        "RW": ("RW", "FWD", 70, 12), "ST": ("ST", "FWD", 78, 34), "LW": ("LW", "FWD", 70, 56),
    },
}

ROLES = ["GK", "RB", "RCB", "LCB", "LB", "RCM", "CM", "LCM", "RW", "ST", "LW"]
SHIRT_NUMBERS = {"GK": 1, "RB": 2, "RCB": 5, "LCB": 6, "LB": 3, "RCM": 8, "CM": 4, "LCM": 10, "RW": 7, "ST": 9, "LW": 11}

# Premier League clubs, with made-up squads (no real players).
# key: (name, short name, kit colour, change colour, formation, home ground, written squad by role or None)
CLUBS: dict[str, tuple[str, str, str, str, str, str, list[str] | None]] = {
    "arsenal": ("Arsenal", "ARS", "#EF0107", "#F5C300", "4-3-3", "Emirates Stadium", [
        "Ivo Hartmann", "Callum Reyes", "Tobias Lindqvist", "Andre Mbeki", "Felix Duarte", "Rowan Ashby",
        "Mateo Kristensen", "Nils Okonjo", "Dario Vance", "Aayush Maharjan", "Leo Marchetti"]),
    "chelsea": ("Chelsea", "CHE", "#034694", "#DBA111", "4-2-3-1", "Stamford Bridge", [
        "Samuel Osei-Brandt", "Joel Ferreira-Lund", "Viktor Haldane", "Emre Castell", "Owen Pryce", "Theo Albrecht",
        "Bastian Nwosu", "Rafael Quint", "Jamal Sorensen", "Lucas Ferrante", "Milo Achterberg"]),
    "astonvilla": ("Aston Villa", "AVL", "#7A003C", "#95BFE5", "4-2-3-1", "Villa Park", None),
    "bournemouth": ("Bournemouth", "BOU", "#DA291C", "#3D3D3D", "4-2-3-1", "Vitality Stadium", None),
    "brentford": ("Brentford", "BRE", "#E30613", "#FBB800", "4-3-3", "Gtech Community Stadium", None),
    "brighton": ("Brighton", "BHA", "#0057B8", "#FFCD00", "4-2-3-1", "Amex Stadium", None),
    "burnley": ("Burnley", "BUR", "#6C1D45", "#99D6EA", "4-4-2", "Turf Moor", None),
    "palace": ("Crystal Palace", "CRY", "#1B458F", "#C4122E", "3-4-3", "Selhurst Park", None),
    "everton": ("Everton", "EVE", "#003399", "#F28C28", "4-2-3-1", "Hill Dickinson Stadium", None),
    "fulham": ("Fulham", "FUL", "#3A3A3A", "#CC0000", "4-2-3-1", "Craven Cottage", None),
    "leeds": ("Leeds United", "LEE", "#1D428A", "#FFCD00", "4-3-3", "Elland Road", None),
    "liverpool": ("Liverpool", "LIV", "#C8102E", "#00B2A9", "4-3-3", "Anfield", None),
    "mancity": ("Manchester City", "MCI", "#6CABDD", "#1C2C5B", "4-3-3", "Etihad Stadium", None),
    "manutd": ("Manchester United", "MUN", "#DA291C", "#FBE122", "3-4-3", "Old Trafford", None),
    "newcastle": ("Newcastle United", "NEW", "#2D2D2D", "#41B6E6", "4-3-3", "St James' Park", None),
    "forest": ("Nottingham Forest", "NFO", "#DD0000", "#F2C14E", "3-5-2", "City Ground", None),
    "sunderland": ("Sunderland", "SUN", "#EB172B", "#3D3D3D", "4-4-2", "Stadium of Light", None),
    "spurs": ("Tottenham Hotspur", "TOT", "#132257", "#00A6E0", "4-3-3", "Tottenham Hotspur Stadium", None),
    "westham": ("West Ham United", "WHU", "#7A263A", "#1BB1E7", "4-4-2", "London Stadium", None),
    "wolves": ("Wolverhampton Wanderers", "WOL", "#FDB913", "#3D3D3D", "3-5-2", "Molineux", None),
}

_FIRST = [
    "Adrian", "Aksel", "Amadou", "Anders", "Arlo", "Bruno", "Caio", "Cian", "Daniel", "Elias", "Emil", "Enzo",
    "Ethan", "Fabian", "Finn", "Gabriel", "Hugo", "Ibrahim", "Isaac", "Jonas", "Joao", "Kai", "Kenji", "Kofi",
    "Lars", "Liam", "Luca", "Marco", "Mason", "Matias", "Max", "Moussa", "Nico", "Noah", "Oscar", "Pablo",
    "Rafa", "Rio", "Ruben", "Samir", "Santi", "Sami", "Tariq", "Teo", "Tomas", "Yannick", "Yusuf", "Zane",
]
_LAST = [
    "Abara", "Albescu", "Bakker", "Banda", "Bellamy", "Brandt", "Calder", "Costa", "Dalgaard", "Delacroix",
    "Diallo", "Ekström", "Ferraz", "Fontaine", "Garrido", "Gunnarsson", "Hale", "Ivanic", "Jansen", "Kamara",
    "Keane", "Kovac", "Laurent", "Lindgren", "Maddox", "Mensah", "Moreau", "Nakamura", "Novak", "Okafor",
    "Olsen", "Pereira", "Quaresma", "Rahman", "Rinaldi", "Rossi", "Sato", "Silva", "Steiner", "Tanaka",
    "Toure", "Varga", "Vidal", "Wexley", "Whitlock", "Yilmaz", "Zielinski", "Zubiri",
]


def _generated_squads() -> dict[str, list[str]]:
    """Made-up squads for the clubs without a written one: the same every time, no name used twice
    in the league and no surname twice in a team."""
    rng = random.Random(2026)
    used = {name for *_, squad in CLUBS.values() if squad for name in squad}
    squads = {}
    for key, (*_, squad) in CLUBS.items():
        if squad:
            continue
        names: list[str] = []
        while len(names) < len(ROLES):
            first, last = rng.choice(_FIRST), rng.choice(_LAST)
            if f"{first} {last}" in used or any(n.endswith(f" {last}") for n in names):
                continue
            names.append(f"{first} {last}")
            used.add(names[-1])
        squads[key] = names
    return squads


_SQUADS = _generated_squads()


# Player ids: home 1-11, away 21-31, so an id alone tells you the side.
_ID_OFFSET = {"home": 1, "away": 21}


def _rgb(color: str) -> tuple[int, int, int]:
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)


def _clash(a: str, b: str) -> bool:
    """Too alike to tell the teams apart on the pitch and in the scores."""
    return sum((x - y) ** 2 for x, y in zip(_rgb(a), _rgb(b))) < 110 ** 2


def build_team(key: str, side: str, color: str | None = None) -> Team:
    name, short_name, kit, _, formation, _, squad = CLUBS[key]
    names = squad or _SQUADS[key]
    spots = FORMATIONS[formation]
    players = [
        Player(id=_ID_OFFSET[side] + i, name=names[i], number=SHIRT_NUMBERS[role], position=spots[role][0],
               role=role, line=spots[role][1])
        for i, role in enumerate(ROLES)
    ]
    return Team(side=side, key=key, name=name, short_name=short_name, color=color or kit, formation=formation,
                players=players)


def build_teams(home: str = "arsenal", away: str = "chelsea") -> tuple[Team, Team]:
    """The away side wears its change colour when the kits clash (Arsenal v Liverpool: both red)."""
    home_kit = CLUBS[home][2]
    away_kit, away_change = CLUBS[away][2], CLUBS[away][3]
    return build_team(home, "home"), build_team(away, "away", away_change if _clash(home_kit, away_kit) else away_kit)


def venue(home: str) -> str:
    return CLUBS[home][5]


def matchday(day: int, size: int = 7) -> list[tuple[str, str]]:
    """The fixtures of a matchday: 7 of the 20 clubs' games, every club at most once."""
    clubs = list(CLUBS)
    random.Random(day).shuffle(clubs)
    return [(clubs[i], clubs[i + 1]) for i in range(0, size * 2, 2)]
