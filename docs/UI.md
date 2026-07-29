# User Interface

**Status:** Deferred — intentionally not yet written.

---

# Why This Document Is Empty

This document describes interface design: editor layout, gate palette behavior, interaction patterns, keyboard model, and visual language.

That work belongs with Milestone 3 (Circuit Editor MVP), which is two milestones away. The current milestone is Foundation.

Designing the interface now would violate the roadmap's own instruction to complete the active milestone before starting the next, and would likely be revised once the framework and editor architecture are settled.

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

At the start of Milestone 3 (Circuit Editor MVP), after the frontend framework is chosen and [Frontend.md](Frontend.md) is written.

---

# Constraints Already Fixed

From `CLAUDE.md`, binding on whatever is written here later:

* the interface is clean, accessible, responsive, and educational
* animation must improve understanding rather than decorate
* keyboard navigation is supported wherever practical
* color contrast is sufficient, and color is never the sole carrier of meaning

From [Vision.md](Vision.md):

* visualization is a primary feature, not a skin over the editor
* a newcomer should be able to understand *why* a result occurred, not only see it
