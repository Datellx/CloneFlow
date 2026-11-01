"""Plans. No prices yet: Starter is free; Growth and Pro are arranged with us."""
from __future__ import annotations

PLANS: dict[str, dict] = {
    "starter": {"key": "starter", "name": "Starter", "employees": 3, "free": True,
                "blurb": "Free. For your first handovers."},
    "growth": {"key": "growth", "name": "Growth", "employees": 25, "free": False,
               "blurb": "For teams with regular turnover."},
    "pro": {"key": "pro", "name": "Pro", "employees": 100, "free": False,
            "blurb": "For larger organizations and rollouts."},
}


def plan_of(org) -> dict:
    return PLANS.get((getattr(org, "plan", None) or "starter"), PLANS["starter"])
