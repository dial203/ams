"""Built-in form templates. Every schema is valid per docs/FORMS.md (checked by tests).

References are listed only where the citation is certain; otherwise the list is empty.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class FormTemplate:
    key: str
    name: str
    description: str
    kind: str
    sensitivity: str
    schema: dict[str, Any]
    references: list[str] = field(default_factory=list)
    athlete_can_submit: bool = False
    athlete_can_view: bool = False
    allow_multiple_per_day: bool = True

    def schema_copy(self) -> dict[str, Any]:
        return copy.deepcopy(self.schema)


def _scale(key: str, label: str, low: str, high: str, help_text: str | None = None) -> dict[str, Any]:
    f: dict[str, Any] = {
        "key": key,
        "type": "scale",
        "label": label,
        "required": True,
        "min": 1,
        "max": 7,
        "step": 1,
        "anchors": {"min": low, "max": high},
        "display": "buttons",
    }
    if help_text:
        f["help"] = help_text
    return f


_RPE_OPTIONS = [
    {"value": 0, "label": "0 - Rest"},
    {"value": 1, "label": "1 - Very, very easy"},
    {"value": 2, "label": "2 - Easy"},
    {"value": 3, "label": "3 - Moderate"},
    {"value": 4, "label": "4 - Somewhat hard"},
    {"value": 5, "label": "5 - Hard"},
    {"value": 6, "label": "6"},
    {"value": 7, "label": "7 - Very hard"},
    {"value": 8, "label": "8"},
    {"value": 9, "label": "9"},
    {"value": 10, "label": "10 - Maximal"},
]

WELLNESS_HOOPER = FormTemplate(
    key="wellness_hooper",
    name="Morning wellness (Hooper)",
    description="Daily Hooper index: sleep quality, fatigue, stress and muscle soreness on 1-7 scales "
    "(1 = very, very good / low, 7 = very, very bad / high), summed to a 4-28 total. Higher is worse.",
    kind="questionnaire",
    sensitivity="general",
    athlete_can_submit=True,
    athlete_can_view=True,
    allow_multiple_per_day=False,
    references=[
        "Hooper S.L. & Mackinnon L.T. (1995). Monitoring overtraining in athletes. Sports Med 20(5):321-327. "
        "https://doi.org/10.2165/00007256-199520050-00003",
    ],
    schema={
        "schema_version": 1,
        "sections": [
            {
                "key": "wellness",
                "title": "This morning",
                "description": "Rate each item for the last 24 hours.",
                "fields": [
                    _scale("sleep_quality", "Sleep quality", "Very, very good", "Very, very bad"),
                    _scale("fatigue", "Fatigue", "Very, very low", "Very, very high"),
                    _scale("stress", "Stress", "Very, very low", "Very, very high"),
                    _scale("soreness", "Muscle soreness", "Very, very low", "Very, very high"),
                    {
                        "key": "hooper_total",
                        "type": "calculated",
                        "label": "Hooper index",
                        "expression": "sum(sleep_quality, fatigue, stress, soreness)",
                        "decimals": 0,
                        "unit": "AU",
                    },
                    {
                        "key": "sleep_hours",
                        "type": "number",
                        "label": "Hours slept",
                        "min": 0,
                        "max": 24,
                        "step": 0.25,
                        "decimals": 2,
                        "unit": "h",
                    },
                ],
            },
            {
                "key": "pain",
                "title": "Pain",
                "fields": [
                    {"key": "has_pain", "type": "boolean", "label": "Any pain or injury?", "required": True},
                    {
                        "key": "pain_location",
                        "type": "multiselect",
                        "label": "Where?",
                        "required": True,
                        "visible_if": "has_pain == true",
                        "options": [
                            {"value": "head_neck", "label": "Head / neck"},
                            {"value": "shoulder", "label": "Shoulder"},
                            {"value": "back", "label": "Back"},
                            {"value": "hip_groin", "label": "Hip / groin"},
                            {"value": "thigh", "label": "Thigh"},
                            {"value": "knee", "label": "Knee"},
                            {"value": "lower_leg", "label": "Lower leg"},
                            {"value": "ankle_foot", "label": "Ankle / foot"},
                            {"value": "other", "label": "Other"},
                        ],
                        "max_selected": 3,
                    },
                    {
                        "key": "pain_score",
                        "type": "scale",
                        "label": "Pain (0-10)",
                        "required": True,
                        "min": 0,
                        "max": 10,
                        "visible_if": "has_pain",
                        "anchors": {"min": "No pain", "max": "Worst imaginable"},
                    },
                    {"key": "comment", "type": "textarea", "label": "Anything else?", "max_length": 1000},
                ],
            },
        ],
    },
)

SESSION_RPE = FormTemplate(
    key="session_rpe",
    name="Session RPE",
    description="Session rating of perceived exertion on the CR-10 scale, collected about 30 minutes after the "
    "session, multiplied by duration in minutes to give session load in arbitrary units.",
    kind="session",
    sensitivity="general",
    athlete_can_submit=True,
    athlete_can_view=True,
    allow_multiple_per_day=True,
    references=[
        "Foster C. et al. (2001). A new approach to monitoring exercise training. J Strength Cond Res "
        "15(1):109-115. https://pubmed.ncbi.nlm.nih.gov/11708692/",
    ],
    schema={
        "schema_version": 1,
        "sections": [
            {
                "key": "session",
                "title": "Session",
                "fields": [
                    {
                        "key": "session_type",
                        "type": "select",
                        "label": "Session type",
                        "required": True,
                        "options": [
                            {"value": "field", "label": "Field / track"},
                            {"value": "gym", "label": "Gym / strength"},
                            {"value": "conditioning", "label": "Conditioning"},
                            {"value": "competition", "label": "Competition"},
                            {"value": "other", "label": "Other"},
                        ],
                    },
                    {
                        "key": "rpe",
                        "type": "select",
                        "label": "How hard was your session? (CR-10)",
                        "required": True,
                        "options": _RPE_OPTIONS,
                    },
                    {
                        "key": "duration",
                        "type": "duration",
                        "label": "Duration",
                        "required": True,
                        "min": 0,
                        "max": 600,
                        "unit": "min",
                    },
                    {
                        "key": "srpe",
                        "type": "calculated",
                        "label": "Session load",
                        "expression": "rpe * duration",
                        "decimals": 0,
                        "unit": "AU",
                    },
                    {"key": "notes", "type": "textarea", "label": "Notes", "max_length": 1000},
                ],
            }
        ],
    },
)

INJURY_REPORT = FormTemplate(
    key="injury_report",
    name="Injury report",
    description="Medical record of a new injury or illness: onset, body region, side, mechanism, diagnosis and "
    "availability. Medical sensitivity: visible to admins and medical staff only.",
    kind="medical",
    sensitivity="medical",
    athlete_can_submit=False,
    athlete_can_view=False,
    allow_multiple_per_day=True,
    references=[],
    schema={
        "schema_version": 1,
        "sections": [
            {
                "key": "event",
                "title": "Event",
                "fields": [
                    {"key": "onset_date", "type": "date", "label": "Date of onset", "required": True},
                    {
                        "key": "problem_type",
                        "type": "select",
                        "label": "Type",
                        "required": True,
                        "options": [
                            {"value": "injury", "label": "Injury"},
                            {"value": "illness", "label": "Illness"},
                        ],
                    },
                    {
                        "key": "body_region",
                        "type": "select",
                        "label": "Body region",
                        "required": True,
                        "visible_if": "problem_type == 'injury'",
                        "options": [
                            {"value": "head_neck", "label": "Head / neck"},
                            {"value": "shoulder", "label": "Shoulder"},
                            {"value": "upper_arm_elbow", "label": "Upper arm / elbow"},
                            {"value": "forearm_wrist_hand", "label": "Forearm / wrist / hand"},
                            {"value": "chest_abdomen", "label": "Chest / abdomen"},
                            {"value": "back", "label": "Thoracic / lumbar spine"},
                            {"value": "hip_groin", "label": "Hip / groin"},
                            {"value": "thigh", "label": "Thigh"},
                            {"value": "knee", "label": "Knee"},
                            {"value": "lower_leg", "label": "Lower leg / Achilles"},
                            {"value": "ankle", "label": "Ankle"},
                            {"value": "foot", "label": "Foot"},
                        ],
                    },
                    {
                        "key": "side",
                        "type": "select",
                        "label": "Side",
                        "visible_if": "problem_type == 'injury'",
                        "options": [
                            {"value": "left", "label": "Left"},
                            {"value": "right", "label": "Right"},
                            {"value": "bilateral", "label": "Bilateral"},
                            {"value": "central", "label": "Central / not applicable"},
                        ],
                    },
                    {
                        "key": "mechanism",
                        "type": "select",
                        "label": "Mechanism",
                        "visible_if": "problem_type == 'injury'",
                        "options": [
                            {"value": "contact", "label": "Contact"},
                            {"value": "non_contact", "label": "Non-contact"},
                            {"value": "overuse", "label": "Gradual onset / overuse"},
                            {"value": "unknown", "label": "Unknown"},
                        ],
                    },
                    {
                        "key": "activity",
                        "type": "select",
                        "label": "Activity at onset",
                        "options": [
                            {"value": "training", "label": "Training"},
                            {"value": "competition", "label": "Competition"},
                            {"value": "other", "label": "Other"},
                        ],
                    },
                ],
            },
            {
                "key": "assessment",
                "title": "Assessment",
                "fields": [
                    {"key": "diagnosis", "type": "text", "label": "Diagnosis", "max_length": 200},
                    {
                        "key": "pain_score",
                        "type": "scale",
                        "label": "Pain (0-10)",
                        "min": 0,
                        "max": 10,
                        "anchors": {"min": "No pain", "max": "Worst imaginable"},
                    },
                    {
                        "key": "availability",
                        "type": "select",
                        "label": "Availability",
                        "required": True,
                        "options": [
                            {"value": "full", "label": "Full training"},
                            {"value": "modified", "label": "Modified training"},
                            {"value": "unavailable", "label": "Unavailable"},
                        ],
                    },
                    {
                        "key": "expected_days_out",
                        "type": "number",
                        "label": "Expected days out",
                        "min": 0,
                        "max": 730,
                        "step": 1,
                        "unit": "days",
                        "visible_if": "availability != 'full'",
                    },
                    {
                        "key": "expected_return",
                        "type": "calculated",
                        "label": "Severity band",
                        "expression": "if(isnull(expected_days_out), null, if(expected_days_out > 28, 'severe', "
                        "if(expected_days_out > 7, 'moderate', 'minor')))",
                    },
                    {"key": "notes", "type": "textarea", "label": "Clinical notes", "max_length": 5000},
                ],
            },
        ],
    },
)

CMJ_TEST = FormTemplate(
    key="cmj_test",
    name="Countermovement jump (force plate)",
    description="Best countermovement jump from a force-plate test: jump height (impulse-momentum), "
    "RSI-modified, peak power and system body mass. Relative peak power is calculated.",
    kind="test",
    sensitivity="general",
    athlete_can_submit=False,
    athlete_can_view=True,
    allow_multiple_per_day=True,
    references=[],
    schema={
        "schema_version": 1,
        "sections": [
            {
                "key": "cmj",
                "title": "Countermovement jump",
                "fields": [
                    {
                        "key": "jump_height_cm",
                        "type": "number",
                        "label": "Jump height",
                        "required": True,
                        "min": 0,
                        "max": 120,
                        "decimals": 1,
                        "unit": "cm",
                    },
                    {
                        "key": "rsi_mod",
                        "type": "number",
                        "label": "RSI-modified",
                        "help": "Jump height (m) divided by time to take-off (s).",
                        "min": 0,
                        "max": 3,
                        "decimals": 2,
                        "unit": "m/s",
                    },
                    {
                        "key": "time_to_takeoff_ms",
                        "type": "number",
                        "label": "Time to take-off",
                        "min": 0,
                        "max": 3000,
                        "decimals": 0,
                        "unit": "ms",
                    },
                    {
                        "key": "peak_power_w",
                        "type": "number",
                        "label": "Peak power",
                        "min": 0,
                        "max": 15000,
                        "decimals": 0,
                        "unit": "W",
                    },
                    {
                        "key": "body_mass_kg",
                        "type": "number",
                        "label": "Body mass",
                        "required": True,
                        "min": 30,
                        "max": 250,
                        "decimals": 1,
                        "unit": "kg",
                    },
                    {
                        "key": "peak_power_rel",
                        "type": "calculated",
                        "label": "Relative peak power",
                        "expression": "peak_power_w / body_mass_kg",
                        "decimals": 1,
                        "unit": "W/kg",
                    },
                    {
                        "key": "rsi_mod_calc",
                        "type": "calculated",
                        "label": "RSI-modified (reported or calculated)",
                        "expression": "coalesce(rsi_mod, round((jump_height_cm / 100) / (time_to_takeoff_ms / 1000), 2))",
                        "unit": "m/s",
                    },
                    {"key": "trials", "type": "number", "label": "Trials", "min": 1, "max": 10, "step": 1},
                    {"key": "notes", "type": "text", "label": "Notes", "max_length": 300},
                ],
            }
        ],
    },
)

GPS_SESSION = FormTemplate(
    key="gps_session",
    name="GPS session summary",
    description="Per-athlete session summary from a GPS/LPS system: total distance, high-speed running, sprint "
    "distance, accelerations, decelerations, player load and duration. Zone thresholds depend on the vendor "
    "export and should be recorded in the notes.",
    kind="session",
    sensitivity="general",
    athlete_can_submit=False,
    athlete_can_view=True,
    allow_multiple_per_day=True,
    references=[],
    schema={
        "schema_version": 1,
        "sections": [
            {
                "key": "gps",
                "title": "GPS summary",
                "fields": [
                    {
                        "key": "duration_min",
                        "type": "duration",
                        "label": "Duration",
                        "required": True,
                        "min": 0,
                        "max": 600,
                        "unit": "min",
                    },
                    {
                        "key": "total_distance_m",
                        "type": "number",
                        "label": "Total distance",
                        "required": True,
                        "min": 0,
                        "max": 50000,
                        "decimals": 0,
                        "unit": "m",
                    },
                    {
                        "key": "hsr_distance_m",
                        "type": "number",
                        "label": "High-speed running distance",
                        "min": 0,
                        "max": 20000,
                        "decimals": 0,
                        "unit": "m",
                    },
                    {
                        "key": "sprint_distance_m",
                        "type": "number",
                        "label": "Sprint distance",
                        "min": 0,
                        "max": 10000,
                        "decimals": 0,
                        "unit": "m",
                    },
                    {"key": "accelerations", "type": "number", "label": "Accelerations", "min": 0, "max": 1000, "step": 1},
                    {"key": "decelerations", "type": "number", "label": "Decelerations", "min": 0, "max": 1000, "step": 1},
                    {
                        "key": "player_load",
                        "type": "number",
                        "label": "Player load",
                        "min": 0,
                        "max": 5000,
                        "decimals": 1,
                        "unit": "AU",
                    },
                    {
                        "key": "max_speed_ms",
                        "type": "number",
                        "label": "Maximum speed",
                        "min": 0,
                        "max": 13,
                        "decimals": 2,
                        "unit": "m/s",
                    },
                    {
                        "key": "distance_per_min",
                        "type": "calculated",
                        "label": "Distance per minute",
                        "expression": "total_distance_m / duration_min",
                        "decimals": 1,
                        "unit": "m/min",
                    },
                    {
                        "key": "hsr_pct",
                        "type": "calculated",
                        "label": "High-speed running share",
                        "expression": "100 * hsr_distance_m / total_distance_m",
                        "decimals": 1,
                        "unit": "%",
                    },
                    {"key": "notes", "type": "text", "label": "Notes (device, zone thresholds)", "max_length": 300},
                ],
            }
        ],
    },
)

BODY_MASS = FormTemplate(
    key="body_mass",
    name="Morning body mass",
    description="Morning body mass (after voiding, before breakfast) and urine specific gravity as a hydration "
    "marker.",
    kind="test",
    sensitivity="general",
    athlete_can_submit=True,
    athlete_can_view=True,
    allow_multiple_per_day=False,
    references=[],
    schema={
        "schema_version": 1,
        "sections": [
            {
                "key": "morning",
                "title": "Morning measures",
                "fields": [
                    {
                        "key": "body_mass_kg",
                        "type": "number",
                        "label": "Body mass",
                        "required": True,
                        "min": 30,
                        "max": 250,
                        "decimals": 1,
                        "unit": "kg",
                        "help": "After voiding, before eating or drinking, minimal clothing.",
                    },
                    {
                        "key": "usg",
                        "type": "number",
                        "label": "Urine specific gravity",
                        "min": 1.0,
                        "max": 1.05,
                        "step": 0.001,
                        "decimals": 3,
                    },
                    {
                        "key": "hydration",
                        "type": "calculated",
                        "label": "Hydration flag",
                        "expression": "if(isnull(usg), null, if(usg > 1.02, 'check', 'ok'))",
                    },
                    {"key": "notes", "type": "text", "label": "Notes", "max_length": 300},
                ],
            }
        ],
    },
)

TEMPLATES: dict[str, FormTemplate] = {
    t.key: t for t in (WELLNESS_HOOPER, SESSION_RPE, INJURY_REPORT, CMJ_TEST, GPS_SESSION, BODY_MASS)
}
