"""Fictional clubs and squads. No real clubs or players."""

from .events import Player, Team

# 4-3-3 starting spots in the team's own attacking frame (as if attacking toward x=105):
# x = metres from their own goal line; y = metres across, where low y is the team's
# right-hand side when facing the opponent goal.
FORMATION_433 = {
    "GK": (5, 34),
    "RB": (30, 8),
    "RCB": (22, 24),
    "LCB": (22, 44),
    "LB": (30, 60),
    "RCM": (45, 22),
    "CM": (40, 34),
    "LCM": (45, 46),
    "RW": (72, 10),
    "ST": (78, 34),
    "LW": (72, 58),
}

_SQUADS = {
    "home": {
        "name": "Northbridge FC",
        "short_name": "NBR",
        "color": "#1f6feb",
        "players": [  # (number, name, position)
            (1, "Ivo Hartmann", "GK"),
            (2, "Callum Reyes", "RB"),
            (5, "Tobias Lindqvist", "RCB"),
            (6, "Andre Mbeki", "LCB"),
            (3, "Felix Duarte", "LB"),
            (8, "Rowan Ashby", "RCM"),
            (4, "Mateo Kristensen", "CM"),
            (10, "Nils Okonjo", "LCM"),
            (7, "Dario Vance", "RW"),
            (9, "Aayush Maharjan", "ST"),
            (11, "Leo Marchetti", "LW"),
        ],
    },
    "away": {
        "name": "Harbor City",
        "short_name": "HBC",
        "color": "#e5534b",
        "players": [
            (1, "Samuel Osei-Brandt", "GK"),
            (2, "Joel Ferreira-Lund", "RB"),
            (4, "Viktor Haldane", "RCB"),
            (5, "Emre Castell", "LCB"),
            (3, "Owen Pryce", "LB"),
            (8, "Theo Albrecht", "RCM"),
            (6, "Bastian Nwosu", "CM"),
            (10, "Rafael Quint", "LCM"),
            (7, "Jamal Sorensen", "RW"),
            (9, "Lucas Ferrante", "ST"),
            (11, "Milo Achterberg", "LW"),
        ],
    },
}

# Player ids: home 1-11, away 21-31, so an id alone tells you the side.
_ID_OFFSET = {"home": 1, "away": 21}


def build_teams() -> tuple[Team, Team]:
    teams = []
    for side, squad in _SQUADS.items():
        players = [
            Player(id=_ID_OFFSET[side] + i, name=name, number=number, position=position)
            for i, (number, name, position) in enumerate(squad["players"])
        ]
        teams.append(
            Team(
                side=side,
                name=squad["name"],
                short_name=squad["short_name"],
                color=squad["color"],
                formation="4-3-3",
                players=players,
            )
        )
    return teams[0], teams[1]
