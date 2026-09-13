"""Analysis run ownership and visibility helpers."""

from dataclasses import dataclass


@dataclass
class AnalysisRun:
    id: str
    owner_id: str
    status: str = "pending"
    quarantined: bool = False

    def is_visible_to(self, user_id: str) -> bool:
        return self.owner_id == user_id and not self.quarantined
