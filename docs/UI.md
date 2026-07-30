# User Interface

**Status:** Not yet written — and now **due**. Milestone 3 is the active milestone.

---

# Why This Document Is Still Empty

This document describes interface design: editor layout, gate palette behavior, interaction patterns, keyboard model, and visual language.

It was deferred through Milestones 1 and 2 on purpose. Designing an interface against a provisional data model means revising it once the model settles, and the roadmap's own instruction is to finish the active milestone before starting the next.

That reason has expired. The Circuit Model closed on 2026-07-30, the framework is chosen, and [Frontend.md](Frontend.md) is written — so the preconditions listed under *When* below are all met. **This document should be written at the start of the editor work, before components are built rather than after.**

---

# What Will Go Here

* editor layout and screen regions
* gate palette organization and discovery
* placing, moving, and removing gates
* multi-qubit gate interaction, including control placement
* selection, undo, and redo behavior
* results panel and visualization placement
* keyboard model and shortcut map
* empty, loading, and error states
* visual language: spacing, color roles, typography, motion

---

# When

At the start of Milestone 3 (Circuit Editor MVP), after the frontend framework is chosen and [Frontend.md](Frontend.md) is written. **Both are now true.**

---

# Constraints Already Fixed

Two that Milestone 2 added, and that are not negotiable here:

* **Gate positions are derived, never stored.** `frontend/src/cycles/` returns the cycle decomposition and the barrier placements a renderer needs. No component may hold its own copy of a gate's coordinates — that is the duplicated state [Architecture.md](Architecture.md) forbids, and the reason rendering is direct SVG rather than a node-graph library.
* **Validation already exists.** `frontend/src/validation/` reports every violation with a code and a document path. Inline feedback should render those, not re-derive them.

From `CLAUDE.md`, binding on whatever is written here later:

* the interface is clean, accessible, responsive, and educational
* animation must improve understanding rather than decorate
* keyboard navigation is supported wherever practical
* color contrast is sufficient, and color is never the sole carrier of meaning

From [Vision.md](Vision.md):

* visualization is a primary feature, not a skin over the editor
* a newcomer should be able to understand *why* a result occurred, not only see it
