"""Cycle derivation: the decomposition specified in ADR-0003.

Groups a circuit's flat operation list into concurrent cycles by
as-soon-as-possible packing over a per-resource frontier. The result is never
stored -- ADR-0001 makes the operation list canonical and the decomposition
derived, so analysis, simulation, and rendering each call this and discard the
result.

Implemented once per language and held to `frontend/src/cycles/` by the
fixtures in shared/fixtures/decomposition/. A disagreement between the two is
a bug in one of them or an ADR-0003 revision, never a fixture to regenerate.

Empty until Milestone 2.
"""
