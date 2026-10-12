"""The single place that answers "who may see and do what" (docs/ARCHITECTURE.md "Permissions").

* ``owner`` / ``admin``: every athlete in the org, every sensitivity, read/write, identifiable.
* ``staff``: athletes *currently* in an assigned group or one of its descendants. Rights over an
  athlete are the union across every assignment that covers the athlete:

  ===============  =========  =========  ==========  =====
  access_role      general    medical    research    write
  ===============  =========  =========  ==========  =====
  viewer           read       -          -           no
  coach            read       -          -           yes
  practitioner     read       -          -           yes
  medical          read       read       -           yes
  researcher       read       -          read        yes
  ===============  =========  =========  ==========  =====

  Writing form data needs a write-capable role *and* read access to the form's sensitivity
  through the same assignment. ``can_view_identifiable`` is also a union: an athlete is masked
  only when no covering assignment allows identifiable access.
* ``athlete``: themselves only; submissions of forms with ``athlete_can_view`` (read) and
  ``athlete_can_submit`` (write).

Everything not visible is reported as 404 by the routes (never 403), so the existence of
athletes, forms or submissions outside a caller's scope does not leak. Cross-org access is
always 404 because ``get_principal`` requires a membership in the path's org.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from functools import cached_property

from sqlalchemy import ColumnElement, Select, and_, false, or_, select, true
from sqlalchemy.orm import Session

from app.models import Athlete, AthleteGroup, Form, Group, Organization, OrgMembership, StaffAssignment, User
from app.timeutil import today_in

ALL_SENSITIVITIES: frozenset[str] = frozenset({"general", "medical", "research"})
ROLE_SENSITIVITIES: dict[str, frozenset[str]] = {
    "viewer": frozenset({"general"}),
    "coach": frozenset({"general"}),
    "practitioner": frozenset({"general"}),
    "medical": frozenset({"general", "medical"}),
    "researcher": frozenset({"general", "research"}),
}
WRITE_ROLES: frozenset[str] = frozenset({"coach", "practitioner", "medical", "researcher"})
ADMIN_ROLES: frozenset[str] = frozenset({"owner", "admin"})
STAFF_ROLES: frozenset[str] = frozenset({"owner", "admin", "staff"})


@dataclass(frozen=True)
class AthleteRights:
    identifiable: bool
    write: bool  # may edit the athlete record / group membership
    read: frozenset[str]  # readable form sensitivities
    write_forms: frozenset[str]  # writable form sensitivities


FULL_RIGHTS = AthleteRights(identifiable=True, write=True, read=ALL_SENSITIVITIES, write_forms=ALL_SENSITIVITIES)
SELF_RIGHTS = AthleteRights(identifiable=True, write=False, read=frozenset(), write_forms=frozenset())


def current_membership_clause(today: dt.date) -> ColumnElement[bool]:
    return and_(
        AthleteGroup.joined_on <= today,
        or_(AthleteGroup.left_on.is_(None), AthleteGroup.left_on > today),
    )


class GroupTree:
    def __init__(self, rows: Iterable[tuple[uuid.UUID, uuid.UUID | None]]) -> None:
        self.parent: dict[uuid.UUID, uuid.UUID | None] = {}
        self.children: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
        for gid, parent_id in rows:
            self.parent[gid] = parent_id
            if parent_id is not None:
                self.children[parent_id].append(gid)

    def descendants(self, gid: uuid.UUID) -> set[uuid.UUID]:
        """The group itself and all of its descendants."""
        out: set[uuid.UUID] = set()
        stack = [gid]
        while stack:
            g = stack.pop()
            if g in out:
                continue
            out.add(g)
            stack.extend(self.children.get(g, []))
        return out

    def ancestors(self, gid: uuid.UUID) -> list[uuid.UUID]:
        out: list[uuid.UUID] = []
        seen = {gid}
        cur = self.parent.get(gid)
        while cur is not None and cur not in seen:
            out.append(cur)
            seen.add(cur)
            cur = self.parent.get(cur)
        return out

    def with_ancestors(self, gids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
        out: set[uuid.UUID] = set()
        for g in gids:
            out.add(g)
            out.update(self.ancestors(g))
        return out


def load_group_tree(db: Session, org_id: uuid.UUID) -> GroupTree:
    return GroupTree(db.execute(select(Group.id, Group.parent_id).where(Group.org_id == org_id)).all())


class Principal:
    """A user acting inside one organization."""

    def __init__(
        self,
        db: Session,
        user: User,
        org: Organization,
        membership: OrgMembership,
        athlete_id: uuid.UUID | None,
        role: str | None = None,
    ) -> None:
        self.db = db
        self.user = user
        self.org = org
        self.membership = membership
        self.role = role or membership.role
        self.athlete_id = athlete_id
        self.today = today_in(org.timezone)

    # ------------------------------------------------------------------ roles
    @property
    def org_id(self) -> uuid.UUID:
        return self.org.id

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

    @property
    def is_admin(self) -> bool:
        return self.role in ADMIN_ROLES

    @property
    def is_staff(self) -> bool:
        """Owner, admin or staff (anyone who is not an athlete)."""
        return self.role in STAFF_ROLES

    @property
    def is_athlete(self) -> bool:
        return self.role == "athlete"

    # ------------------------------------------------------------------ scopes
    @cached_property
    def tree(self) -> GroupTree:
        return load_group_tree(self.db, self.org_id)

    @cached_property
    def assignments(self) -> list[StaffAssignment]:
        if self.role != "staff":
            return []
        return list(
            self.db.scalars(
                select(StaffAssignment).where(
                    StaffAssignment.org_id == self.org_id, StaffAssignment.user_id == self.user_id
                )
            )
        )

    @cached_property
    def _scopes(self) -> list[tuple[StaffAssignment, frozenset[uuid.UUID]]]:
        return [(a, frozenset(self.tree.descendants(a.group_id))) for a in self.assignments]

    def _groups_where(self, pred: Callable[[StaffAssignment], bool]) -> frozenset[uuid.UUID]:
        out: set[uuid.UUID] = set()
        for a, groups in self._scopes:
            if pred(a):
                out |= groups
        return frozenset(out)

    @cached_property
    def visible_group_ids(self) -> frozenset[uuid.UUID]:
        """Groups whose current members the caller can see (staff only)."""
        return self._groups_where(lambda a: True)

    @cached_property
    def writable_group_ids(self) -> frozenset[uuid.UUID]:
        return self._groups_where(lambda a: a.access_role in WRITE_ROLES)

    @cached_property
    def identifiable_group_ids(self) -> frozenset[uuid.UUID]:
        return self._groups_where(lambda a: a.can_view_identifiable)

    def readable_group_ids(self, sensitivity: str) -> frozenset[uuid.UUID]:
        return self._groups_where(lambda a: sensitivity in ROLE_SENSITIVITIES[a.access_role])

    def form_writable_group_ids(self, sensitivity: str) -> frozenset[uuid.UUID]:
        return self._groups_where(
            lambda a: a.access_role in WRITE_ROLES and sensitivity in ROLE_SENSITIVITIES[a.access_role]
        )

    def _athletes_in(self, group_ids: Iterable[uuid.UUID]) -> Select[tuple[uuid.UUID]]:
        return select(AthleteGroup.athlete_id).where(
            AthleteGroup.org_id == self.org_id,
            AthleteGroup.group_id.in_(list(group_ids)),
            current_membership_clause(self.today),
        )

    # ------------------------------------------------------------------ SQL filters
    def visible_athletes_clause(self, athlete_id_col: ColumnElement[uuid.UUID] | None = None) -> ColumnElement[bool]:
        col = athlete_id_col if athlete_id_col is not None else Athlete.id
        if self.is_admin:
            return true()
        if self.is_athlete:
            return col == self.athlete_id if self.athlete_id else false()
        if not self.visible_group_ids:
            return false()
        return col.in_(self._athletes_in(self.visible_group_ids))

    def identifiable_clause(self, athlete_id_col: ColumnElement[uuid.UUID] | None = None) -> ColumnElement[bool]:
        col = athlete_id_col if athlete_id_col is not None else Athlete.id
        if self.is_admin:
            return true()
        if self.is_athlete:
            return col == self.athlete_id if self.athlete_id else false()
        if not self.identifiable_group_ids:
            return false()
        return col.in_(self._athletes_in(self.identifiable_group_ids))

    def readable_submissions_clause(self, athlete_id_col: ColumnElement[uuid.UUID]) -> ColumnElement[bool]:
        """Filter for submission queries joined with ``Form``."""
        if self.is_admin:
            return true()
        if self.is_athlete:
            if not self.athlete_id:
                return false()
            return and_(athlete_id_col == self.athlete_id, Form.athlete_can_view.is_(True))
        parts = []
        for s in sorted(ALL_SENSITIVITIES):
            groups = self.readable_group_ids(s)
            if groups:
                parts.append(and_(Form.sensitivity == s, athlete_id_col.in_(self._athletes_in(groups))))
        return or_(*parts) if parts else false()

    # ------------------------------------------------------------------ per athlete
    def rights_for(self, athlete_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, AthleteRights]:
        """Rights for each *visible* athlete among ``athlete_ids`` (invisible ones are absent)."""
        ids = list(dict.fromkeys(athlete_ids))
        if not ids:
            return {}
        if self.is_admin:
            return dict.fromkeys(ids, FULL_RIGHTS)
        if self.is_athlete:
            return {self.athlete_id: SELF_RIGHTS} if self.athlete_id in ids else {}
        if not self._scopes:
            return {}
        rows = self.db.execute(
            select(AthleteGroup.athlete_id, AthleteGroup.group_id).where(
                AthleteGroup.org_id == self.org_id,
                AthleteGroup.athlete_id.in_(ids),
                current_membership_clause(self.today),
            )
        ).all()
        groups_of: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
        for aid, gid in rows:
            groups_of[aid].add(gid)
        out: dict[uuid.UUID, AthleteRights] = {}
        for aid, groups in groups_of.items():
            covering = [a for a, scope in self._scopes if scope & groups]
            if not covering:
                continue
            read: set[str] = set()
            write_forms: set[str] = set()
            for a in covering:
                sens = ROLE_SENSITIVITIES[a.access_role]
                read |= sens
                if a.access_role in WRITE_ROLES:
                    write_forms |= sens
            out[aid] = AthleteRights(
                identifiable=any(a.can_view_identifiable for a in covering),
                write=any(a.access_role in WRITE_ROLES for a in covering),
                read=frozenset(read),
                write_forms=frozenset(write_forms),
            )
        return out

    def rights(self, athlete_id: uuid.UUID) -> AthleteRights | None:
        return self.rights_for([athlete_id]).get(athlete_id)

    # ------------------------------------------------------------------ forms
    @cached_property
    def readable_sensitivities(self) -> frozenset[str]:
        """Sensitivities readable for at least one athlete (staff), all (admin), none (athlete)."""
        if self.is_admin:
            return ALL_SENSITIVITIES
        out: set[str] = set()
        for a in self.assignments:
            out |= ROLE_SENSITIVITIES[a.access_role]
        return frozenset(out)

    @cached_property
    def writable_sensitivities(self) -> frozenset[str]:
        if self.is_admin:
            return ALL_SENSITIVITIES
        out: set[str] = set()
        for a in self.assignments:
            if a.access_role in WRITE_ROLES:
                out |= ROLE_SENSITIVITIES[a.access_role]
        return frozenset(out)

    def can_read_form(self, form: Form) -> bool:
        """Whether the form (its definition) is visible to the caller at all."""
        if self.is_admin:
            return True
        if self.is_athlete:
            return bool(form.athlete_can_view or form.athlete_can_submit)
        return form.sensitivity in self.readable_sensitivities

    def can_write_form_somewhere(self, form: Form) -> bool:
        if self.is_athlete:
            return bool(form.athlete_can_submit)
        return form.sensitivity in self.writable_sensitivities

    def can_read_form_data(self, form: Form, athlete_id: uuid.UUID, rights: AthleteRights | None = None) -> bool:
        if self.is_admin:
            return True
        if self.is_athlete:
            return athlete_id == self.athlete_id and bool(form.athlete_can_view)
        r = rights if rights is not None else self.rights(athlete_id)
        return r is not None and form.sensitivity in r.read

    def can_write_form_data(self, form: Form, athlete_id: uuid.UUID, rights: AthleteRights | None = None) -> bool:
        if self.is_admin:
            return True
        if self.is_athlete:
            return athlete_id == self.athlete_id and bool(form.athlete_can_submit)
        r = rights if rights is not None else self.rights(athlete_id)
        return r is not None and form.sensitivity in r.write_forms

    # ------------------------------------------------------------------ groups
    def can_write_group(self, group_id: uuid.UUID) -> bool:
        if self.is_admin:
            return True
        return group_id in self.writable_group_ids

    def visible_group_ids_for_listing(self) -> set[uuid.UUID] | None:
        """Groups shown by GET /groups: None = all (admin)."""
        if self.is_admin:
            return None
        if self.is_athlete:
            if not self.athlete_id:
                return set()
            own = set(
                self.db.scalars(
                    select(AthleteGroup.group_id).where(
                        AthleteGroup.athlete_id == self.athlete_id, current_membership_clause(self.today)
                    )
                )
            )
            return self.tree.with_ancestors(own)
        assigned = {a.group_id for a in self.assignments}
        return set(self.visible_group_ids) | self.tree.with_ancestors(assigned)
