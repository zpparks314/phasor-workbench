# User Interface

**Status:** Written for Milestone 3. Results and visualization placement remain
deferred to Milestone 4 — see *Deliberately Deferred* at the end.

This document covers the Circuit Editor MVP: what is on screen, how a circuit is
built, what the keyboard does, and what things look like. It is written before the
components, per the instruction this document carried while it was empty.

Two constraints from Milestone 2 are not negotiable here, and most of the design
below is a consequence of the first:

* **Gate positions are derived, never stored.** `frontend/src/cycles/` returns the
  cycle decomposition and barrier placements. No component holds a coordinate.
* **Validation already exists.** `frontend/src/validation/` reports every
  violation with a code and a document path. Inline feedback renders those; it
  does not re-derive them.

Editing behaviour is specified by
[ADR-0007](decisions/ADR0007_EditingModel.md) and this document does not restate
it. Where the two touch — coalescing during a drag, selection surviving undo —
this document says what the user sees and ADR-0007 says what the code does.

---

# Screen Regions

```text
┌──────────────────────────────────────────────────────────────┐
│  Header      undo · redo · clear · save · save status        │
├───────────┬──────────────────────────────────────┬───────────┤
│           │                                      │           │
│  Palette  │        Circuit Canvas                │ Inspector │
│           │                                      │           │
│           │                                      │           │
│           │                                      │           │
├───────────┴──────────────────────────────────────┴───────────┤
│  Problems     violations from validateCircuit                 │
└──────────────────────────────────────────────────────────────┘
```

Four regions in Milestone 3. The right column was **reserved and not rendered**
through that milestone so that filling it would not be a re-layout, and the
reservation paid off exactly as intended: the inspector fills it at the cost of
one grid template and one `aside`, with nothing else moved. Milestone 4's
results panel joins it below.

The canvas is the only region that scrolls. It scrolls horizontally as the
circuit deepens; the qubit label gutter is sticky against the left edge so wire
identity survives scrolling.

Region order in the DOM matches the reading order above, so tab order needs no
`tabindex` gymnastics.

---

# The Circuit Canvas

## Geometry

One horizontal wire per qubit, ordered by `index` ascending, top to bottom.
Columns correspond one-to-one with cycle indices from `deriveCycles`.

Geometry is a pure function of `(circuit, decomposition)` and is computed on every
render. It lives in `editor/layout.ts`, separate from the components, so it is
testable without a DOM.

| Token | Starting value | What it is |
|---|---|---|
| `lane` | 56px | vertical distance between wire centers |
| `column` | 56px | horizontal distance between cycle centers |
| `glyph` | 40px | edge length of a gate's square |
| `gutter` | 96px | qubit label column, sticky |
| `control` | 5px | radius of a control dot |

These are starting values, defined once and referenced everywhere. A gate is
square and centered on its `(lane, column)` intersection, which keeps single- and
multi-qubit glyphs visually consistent.

## What Gets Drawn

**Wires** run the full width of the circuit, extending one half-column past the
last cycle so a circuit never looks truncated.

**A box means exactly one thing: a single-qubit gate.** This rule is load-bearing
rather than stylistic, and everything below follows from it. A multi-qubit gate
and an unrelated gate frequently share a column — that is the derivation working
correctly, since an intervening wire is not one of the gate's resources — and if
both drew as named boxes joined by a line, the unrelated gate would read as a
third target.

Gates therefore draw in conventional notation:

| Gate | Target |
|---|---|
| `cx`, `ccx` | crossed circle |
| `cz` | filled dot, matching its control, because CZ is symmetric |
| `swap` | a cross at each end |
| `cy` | boxed `Y` — the convention where a gate has no symbol of its own |
| every single-qubit gate | boxed, labelled with the gate name |

Controls are always filled dots. The table lives in `editor/glyphs.ts` typed as a
total `Record<GateName, …>`, so a gate added to `shared/spec/circuit.spec.json`
fails to compile until it has a symbol.

**Symbols carry no text, and that is safe here** only because the grid cell's
accessible name already says `cx`. The symbol is never the sole carrier of
meaning; it replaces a *visible* label, not the announced one.

**Measurements** carry a meter glyph and a connector down to the classical
register lane, annotated with the target bit.

**Barriers** are dashed vertical rules drawn on the *boundary before*
`placement.beforeCycle`, spanning only the lanes in `placement.qubits`. A barrier
whose `beforeCycle` equals `depth` draws at the trailing edge of the circuit —
this is a real case, `trailing_barrier.json` covers it, and it must not be
special-cased away.

**A barrier is reached from the keyboard with `b`**, which steps through the
circuit's barriers from the cursor and wraps. It needs its own command because a
barrier is in no cell -- see *Layering* below -- so no amount of arrowing reaches
one. `Shift` + arrow was the obvious alternative and is deliberately left free:
it conventionally extends selection, which multi-select will want. `Alt` + arrow
is Back and Forward in two browsers.

Because the cell cursor does not follow the selection, the status line names what
is selected. That live region is how a screen reader learns a barrier is selected
at all, since `aria-activedescendant` still points at a cell.

A barrier over a non-contiguous set of wires draws **one segment per contiguous
run**, not a single rule through the wires it skips. A barrier over q0 and q2 does
not constrain q1, and a line crossing q1 would claim it does. Same principle as
the connector gap below, and it holds for the same reason.

**A multi-qubit connector crossing an uninvolved wire is drawn with a gap**, so
the crossing does not read as contact. This is semantically load-bearing rather
than decorative: only `targets` and `controls` are resources in the derivation, so
an intervening wire is genuinely untouched and stays free for concurrent
operations. `multi_qubit_spans_idle_wire.json` is the case to check it against.

There are **two gap widths, and the difference is semantic**:

* over an *empty* wire, a small gap saying "this wire is untouched and free"
* around an *occupied* one, a glyph-sized clearance saying "this line passes that
  gate" — stopping at the glyph's edge instead reads as attachment

Which one applies is derived from the model: the layout asks whether anything
occupies that qubit in that cycle. It is not inferred from geometry.

**Connectors are a single layer beneath every glyph**, not drawn per operation.
Ordering them per operation makes the result depend on document order, so
whichever gate happened to render last drew its line across the other.

## Layering, and Why It Keeps Mattering

The canvas is stacked, bottom to top:

```text
connectors and control dots
glyphs
cells            <- a transparent rectangle over every (qubit, column)
barrier hit targets
the remove button
```

**Anything interactive must sit at or above the cell layer, or be reachable
through it.** The cells cover the whole canvas, and a transparent fill still
receives pointer events, so anything drawn below them is visually present and
completely unclickable. This has caused three separate bugs — a barrier that
could not be selected, a gate that could not be picked up, and a barrier that
could not be dragged — each looking like a missing feature rather than a
layering mistake.

Two consequences worth stating so they are not rediscovered:

* Glyphs are **purely visual**. Pointer handling for a gate or measurement lives
  on its cell, which already knows the operation it contains.
* **A barrier is in no cell.** It sits on the boundary *between* columns and
  appears in no cycle, so `describeCells` cannot place it and the cell layer can
  never hand one back. Its hit target is the only surface that knows where it is,
  which is why selecting and dragging a barrier both go through that layer.

**A test that dispatches an event directly on an element proves nothing about
whether a pointer can reach it.** The gate drag shipped broken with a passing
test for precisely this reason. Interaction tests fire on the element a browser
would actually hit.

## Classical Registers

Registers render as lanes below the qubits, separated by a horizontal rule, drawn
as double lines to distinguish classical from quantum at a glance. A register lane
is labelled with its name and size. Registers with no measurements still render —
a declared register is part of the circuit, and hiding it would make adding a
measurement look like it created one.

---

# Building a Circuit

## Placement

Two mechanisms, both required. Drag is the accelerator; click-to-arm is the
accessible and touch path, and neither is a degraded version of the other.

**Drag** — press a palette gate, drag onto a cell, release.

**Click-to-arm** — click a palette gate to arm it. The cursor and canvas indicate
the armed gate. Click a cell to place. `Escape` disarms.

A cell is a `(qubit, column)` intersection. Hovering or arrowing over one shows a
placement preview at reduced opacity.

## The Drop Column Is a Request, Not a Result

**This is the most important interaction in the editor and the easiest to get
wrong.** The canonical circuit is a flat ordered list; columns are derived by
as-soon-as-possible packing. So a drop must be translated into a list position,
and the derivation then decides where the operation actually appears.

Translating a drop at column `c` on qubit `q`: insert immediately after the last
operation touching `q` that occupies a cycle before `c`, and before the first
operation touching `q` at or after `c`. A qubit's operations are strictly ordered,
so this range always exists and is unambiguous.

The rule has two bounds and needs both: **after** the last operation on an
involved wire that runs before the column, and **before** the first that runs at
or after it. Along a single wire either phrasing alone would do, because a
qubit's operations appear in the list in the order they run.

**Across wires, list order and cycle order come apart**, and that is where this
goes wrong quietly. Two measurements on different qubits can be listed in one
order and run in the other. Scanning only for the last operation before the
column then walks past one that has to follow, and the moved operation lands on
its far side — a barrier dropped beside two measurements stops constraining one
of them, which reads as the measurement moving by itself.

**Every qubit the operation uses counts, not just its target.** A `cx` occupies
its control wire as surely as its target; an index computed from the target alone
ignores everything on the control, and a two-qubit gate dragged rightwards lands
far to the left.

Both of these are the same underlying trap: the operation list is canonical and
cycles are derived, so **list position is not execution time**. Any rule phrased
in terms of "the last thing before" should be read with that in mind.

Re-deriving may then place the operation **earlier than the drop column**, because
ASAP packing pulls it left onto whatever cycle its resources allow. Dropping an
`h` at column 5 of an empty wire lands it in column 0.

**This is correct, and it must be shown rather than hidden.** The gate animates
from the drop position to its derived position. That animation is the one place in
Milestone 3 where motion is doing the job `CLAUDE.md` requires of it — it teaches
that position is a consequence of dependencies, not a coordinate the user set.
Suppressing it, or snapping instantly, would leave the user believing the editor
moved their gate for no reason.

**The tool for holding an operation in a later column is a barrier.** That is what
barriers are for, and an editor whose layout is derived is the clearest possible
place to learn it. When a user repeatedly drops a gate right and watches it slide
left, the palette's barrier entry is the answer, and its tooltip says so.

## Multi-Qubit Gates

A gate's signature comes from `model/spec.ts`. Placing one is a short sequence
rather than a single action:

1. Place the gate on its target wire (two targets for `swap`, placed in order).
2. The editor enters **control assignment** for gates whose signature declares
   controls — one click per control, on the wire it belongs to.
3. The operation is committed once the signature is satisfied.

The pending operation renders throughout, with assigned controls solid and the
remaining count stated in the status line ("Click a wire to place the control").
`Escape` cancels the whole pending operation rather than backing out one step —
partial cancellation invites a half-placed gate nobody meant to keep.

`swap` takes two targets and no controls; `cx` takes one of each. The sequence is
driven by the signature, never by the gate's name or qubit total.

**Only the first click carries a column.** A gate occupies one column across
every wire it uses — that is what makes it one entry in the canonical list — so a
later click has no column to contribute and is read for its wire alone. The
column the *first* click asked for is the request that
[the placement rule](#the-drop-column-is-a-request-not-a-result) resolves, and it
resolves it against every qubit the finished operation names.

**A wire already assigned is refused, not assigned twice.** This is the one place
the editor declines an edit rather than committing it and letting the problems
strip report, and the exception is narrow enough to state precisely: a `cx`
controlled by its own target is a `QUBIT_REUSED_IN_OPERATION` violation that
*nothing in the edit vocabulary can repair*. `retargetOperation` refuses a
multi-qubit operation by design — which of its qubits a retarget meant is
ambiguous — and moving one only changes its column, so the user would be left
with an operation they can only delete. ADR-0007 §7's "edits do not validate"
governs invalid states the user can edit their way out of; this is not one.
The pending overlay draws the taken wires, so the refusal is visible rather than
a click that does nothing for no stated reason.

Arming a different gate abandons a placement in progress, on the same reasoning:
finishing a half-assigned `cx` with a wire meant for the `swap` since armed would
commit a gate nobody asked for.

## Moving and Removing

**Move** — drag a placed operation to a new cell, or select it and press
`Ctrl/Cmd` + an arrow. Resolution uses the same rule as placement, and the same
settle animation applies.

A drag emits transient edits coalescing on `move:<operationId>`, so the whole
gesture is one undo step. **A keyboard move declares no coalescing**, and that
asymmetry is the point of ADR-0007's rule that the interaction decides: a drag has
a beginning and an end, while each key press is a complete action and deserves its
own undo step.

Moving combines two changes that a single gesture happens to express — a
different wire is `retargetOperation`, a different column is `moveOperation`.
**A multi-qubit operation only does the second.** Which of its qubits a drag to
another wire meant to move is ambiguous, and guessing would produce a circuit
nobody asked for.

**Remove** — select and press `Delete` or `Backspace`, or click the `×` that
appears on the selection. The `×` is `aria-hidden`: it is a redundant mouse path
to an action the keyboard already exposes and announces, and a second control
would add a tab stop inside the grid for no gain.

Right-click is deliberately left alone. Deleting on it would be surprising where
every other application opens a menu, and a context menu is disproportionate
machinery for a single command — revisit when there are several.

Moving preserves the operation's identifier; ADR-0007 §6 requires the underlying
edit to reorder rather than remove-and-reinsert.

## Qubits and Registers

Added and removed from controls above the canvas, not from the palette — they are
properties of the circuit rather than things placed in it.

**A region of their own, rather than controls drawn inside the SVG gutter.** This
document originally placed them "in the gutter header", and they sit directly
above it, but they are deliberately outside the canvas. The canvas is a
`role="grid"` composite widget with a single tab stop and
`aria-activedescendant`; focusable buttons inside it break that contract, and
this document already warns that SVG accessibility mapping is unreliable enough
not to bet on. Ordinary HTML controls beside the grid cost nothing and are
announced correctly. The region is itself one tab stop with a roving focus, like
the palette.

Removing a qubit removes every operation that touches it, and removing a register
removes every measurement writing into it. Both are destructive enough to state
before they happen: the control names the count and takes a second press to
confirm ("Remove q2 and 3 operations?"), with `Escape` cancelling. Each is a
single undo step regardless of how much it destroyed.

**The count is derived by running the edit, never by restating its rules**, and
the reason is a case that is easy to get wrong: a barrier over the qubit is
*shrunk* rather than removed, so it is not lost and must not be counted. A
message whose only job is to be accurate should not carry a second copy of the
logic it describes.

**No confirmation when there is nothing to lose.** A bare wire or an unused
register is not a destructive removal, and a prompt that always appears is one
people learn to dismiss without reading.

Qubit indices stay contiguous from 0, so removing a middle qubit renumbers those
below it. Labels are what the user reads; indices are structure — and a register
is labelled by position for the same reason, never by its identifier, which is
opaque per ADR-0002 and is a UUID for anything the editor created.

A register carries a size in bits, editable in place. It is a number input rather
than a pair of stepper buttons: one focusable element instead of two, with arrow
keys already adjusting it natively, so the keyboard path costs no code. The
schema floors a register at one bit. **Shrinking one below a bit a measurement
already writes to is allowed** — `validateCircuit` reports
`CLASSICAL_BIT_OUT_OF_RANGE` and the user can grow it back or remove the
measurement. Refusing is reserved for a state with no repair path.

## Selection

Single selection in Milestone 3. Multi-select is deferred — it changes what
`Delete` and drag mean, and is not needed to build a simple circuit.

Selection is held as an operation identifier and resolved against the present
circuit on read (ADR-0007 §4). Undoing the placement of the selected operation
clears the selection rather than leaving it pointing at nothing.

## Undo and Redo

Header buttons plus shortcuts. Both are labelled with what they will do — "Undo
place H on q0" — from the label ADR-0007 attaches to each history entry. A generic
"Undo" wastes the information the model already carries. History labels are
written to stand alone, so they start capitalised; the button lowercases the first
letter, because there the label is a clause inside a sentence.

Both are disabled, not hidden, when their stack is empty. **This is the opposite
of the palette's `aria-disabled` treatment, and both are deliberate**: an
unavailable palette entry has something to teach — *this needs a register to
measure into* — while an empty undo stack has nothing to say beyond its own
emptiness.

The header is a `role="toolbar"` with a roving focus, so it is one tab stop like
every other region. The roving stop never rests on a disabled control: a
`disabled` button cannot take focus, so an index pointing at one would leave the
region with no way in at all.

## Clear

Empties the operation list, leaving the qubits and registers in place. It names
its count — "Clear 3 operations" — and takes a second press to confirm, the same
treatment as removing a qubit. It is the most destructive control in the editor,
and the fact that one undo reverses it is not a reason to make it a single press:
a user who did not mean it has to notice first. Disabled when there is nothing to
clear.

**Clear is not "new circuit", and the distinction is the reason it can exist
now.** Emptying the operation list is an ordinary edit — one snapshot, one undo
step, and a circuit the user could have reached by deleting each operation in
turn. Resetting the *document*, dropping the wires and registers and identity with
them, is a different act: it needs to know whether there are unsaved changes, so
it belongs with local save rather than before it.

---

# Keyboard Model

Keyboard support is a requirement, not an enhancement, and the canvas is the part
that is easy to leave out.

## Structure

`Tab` moves between regions: header, palette, canvas, problems. Each region is a
**single tab stop** with a roving focus inside it, so a circuit with forty gates
does not put forty stops in the tab order.

The canvas exposes `role="grid"`, one `role="row"` per qubit, and a
`role="gridcell"` per cell, each labelled with its wire, column, and contents
("q0, column 2, Hadamard"). This must be verified against a screen reader rather
than assumed correct — SVG accessibility mapping is inconsistent enough that the
markup being right on paper proves little.

## Shortcuts

| Key | Action |
|---|---|
| `Arrow` keys | move the cell cursor within the canvas |
| `Home` / `End` | first / last column on the current wire |
| `Enter` / `Space` | place the armed gate, or select the operation under the cursor |
| `Delete` / `Backspace` | remove the selection |
| `Escape` | cancel a pending multi-qubit gate, else disarm, else clear selection |
| `Ctrl/Cmd` + arrow | move the selected operation |
| `b` / `Shift` + `B` | select the next / previous barrier |
| `Ctrl/Cmd` + `Z` | undo |
| `Ctrl/Cmd` + `Shift` + `Z` | redo |
| `Ctrl/Cmd` + `S` | save |
| `?` | shortcut reference |

Arrow keys within the palette move between gates; `Enter` arms the focused gate.

Gates this build cannot place are **`aria-disabled`, not `disabled`**. A
`disabled` button is skipped in silence, so arrowing across the palette would pass
over them without saying why — for a teaching tool, the wrong kind of quiet. They
stay focusable and announce that they are unavailable.

Every gate in `circuit.spec.json` is placeable now that control assignment
exists, so the rule's subject today is **measurement with no classical register
declared** — it has nowhere to write. Availability depends on the circuit rather
than on the entry, so the editor decides it and the palette renders it.

Hovering a cell moves the cursor, so the placement preview follows the mouse.
Pointer and keyboard share one cursor rather than the pointer having a hover state
beside it: the cursor means "where the next action lands", and which device put it
there does not change that.

Nothing is reachable by mouse alone. Placement, control assignment, movement,
removal, and save all have keyboard paths — movement by selecting an operation and
arrowing it to a new cell.

---

# Gate Palette

Grouped by what a gate does, because the groups are the teaching structure:

| Group | Contents |
|---|---|
| Identity and Pauli | `i`, `x`, `y`, `z` |
| Superposition | `h` |
| Phase | `s`, `sdg`, `t`, `tdg`, `p` |
| Rotation | `rx`, `ry`, `rz` |
| Two-qubit | `cx`, `cy`, `cz`, `swap` |
| Three-qubit | `ccx` |
| Non-unitary | measurement, barrier |

The gate list is read from `model/spec.ts`, so adding a gate to the shared spec
makes it appear. The *grouping* is editorial and lives in the palette — it is the
one place a gate's name is not sufficient.

Each entry shows its symbol and name, and a tooltip carrying a one-line
description and its signature ("cx — controlled-X. 1 target, 1 control").

**Rotation and phase gates place at π/2 and are edited afterwards, not prompted
for on placement.** This document originally said the opposite, and the reversal
is deliberate: placement is one click, the multi-qubit sequence already makes some
gates take several, and a modal on every `rx` would interrupt exactly the flow
click-to-arm exists to keep fast. The pending-placement state also already owns
the meaning "this placement is not finished", and a prompt would have to share it.

Parameters are in **radians**, as `CircuitModel.md` stores them. No unit
conversion happens anywhere; a hidden one is a bug waiting to happen.

## The Inspector

**Built in Milestone 4**, on 2026-08-02, and this section now describes what
exists.

A panel showing the selected operation's editable properties, and nothing when
nothing is selected. It is where a rotation's angle is changed, and it is
deliberately general rather than a rotation-angle box: **a measurement's register
and bit belong here too**, and so does any future per-operation property. Both of
those were on the deferred list, which was the argument for one panel rather than
a control per property — and both closed together when it landed.

Editing a parameter goes through `setParameters` like every other change — one
edit, one undo step, labelled with what it did. An invalid or non-finite value is
reported by `validateCircuit` in the problems strip rather than refused at the
input, on the same principle as everything else the editor accepts: the user can
fix it, so it is a state to report rather than a state to prevent.

An operation with nothing to edit — an `h`, a `cx`, a barrier — says so rather
than showing an empty panel. A panel that renders nothing is indistinguishable
from a broken one.

**Which parameters a gate has is read from the signature in `model/spec.ts`,
never from its name.** `p` takes `lambda` where the rotations take `theta`, and a
name-to-parameter mapping written here would be a second copy of
`circuit.spec.json`. A gate added to the spec gets its controls for free.

### Angles

Two controls over one value: a number input for saying *exactly*
0.7853981633974483, and a slider for finding out what the gate does as the angle
sweeps. The slider spans a full turn each way; angles beyond it stay reachable by
typing and are never clamped, because `rz` by 7π is a legitimate circuit and an
input that clamped on render would rewrite the circuit just by displaying it.

Both coalesce into one history entry, closed when the interaction ends — the
mechanism ADR-0007 built for gate drags. Exploring an angle costs one undo step,
not one per pointer move.

The two carry **different accessible names** — "theta (radians)" and "Adjust
theta". Two controls over one value are two things a screen reader user has to
tell apart, and near-identical names make that impossible. Neither name repeats
its role, which the reader announces already.

Beside the input, the same value is written relative to π — "π/2" rather than
1.5707963267948966. **This is a rendering, not a second unit**, and the rule that
parameters are radians with no conversion anywhere is intact: the value in, the
value stored, and the value displayed are one number. Only exact sixteenths of a
turn are named as fractions; anything else falls back to a decimal multiple,
because rounding to the nearest clean fraction would print a confident "π/4" for
a value that is not one. The caption is `aria-hidden`, since the input already
announces the authoritative number.

### A measurement's register and bit

A register chooser and a bit. **This is what makes a second register reachable at
all** — placement writes into the first register's lowest free bit and nothing
else could change it, so a circuit with two registers previously could not use
the second.

A bit past the end of its register is permitted and reported as
`CLASSICAL_BIT_OUT_OF_RANGE`, not clamped. The identical circuit is already
reachable by shrinking the register from the structure controls, so refusing it
here would make the same document legal or illegal depending on which control
produced it. A negative or fractional bit *is* refused, because the schema floors
it at an integer 0 — that is shape-invalid rather than semantically wrong, and a
shape-invalid document is one this build cannot re-read.

## The Analysis Panel

Counts, depth, and the gate mix, from `POST /api/v1/circuits/analyze`. Under the
inspector, in the same column.

**Every number in it comes from the backend, and that is the point.** The status
line under the canvas shows a locally derived depth and always will — a render
must not wait on the network — so this is the *backend's* answer to the same
question, sitting a few inches away. The two `deriveCycles` implementations
disagreeing becomes visible to a person, not only to the fixture suite.

Requests are debounced and the one in flight is aborted when the circuit changes
again. Both matter: dragging the angle slider produces a new circuit per pointer
move, and a slow answer about an old circuit must never overwrite a fast answer
about the current one.

A failure is phrased as the user's only when it is theirs. `CIRCUIT_INVALID`
means the problems strip is already listing the reasons, so the panel defers to
it rather than restating them; anything else means the backend is unreachable or
broken, which is not something to blame a person for. The editor stays fully
usable either way.

The gate list is read from `model/spec.ts` and is never hand-written. The
**grouping** above and the descriptions are editorial and live in the palette,
being the two things a gate signature cannot express.

Measurement and barrier sit in the palette rather than in a separate mode. They
are operations, they are placed the same way, and giving them their own mechanism
would obscure that. They are the one hand-written part of the palette, and
deliberately so: both are operation *kinds* in the schema rather than gates, so
there is no generated list they could come from. `CircuitModel.md` is explicit
that `barrier` "is an operation kind, not a gate name".

**A measurement writes into the first register's lowest free bit.** Choosing the
register and the bit is deferred, and this default is the whole of it — a circuit
with two registers cannot yet reach the second. That is a missing feature rather
than a wrong result: the circuit produced is valid, just not necessarily the one
the user wanted.

When every bit is taken, the next one is out of range and the circuit is invalid
until the register grows. That is deliberate rather than clamped. Clamping would
write two measurements to one bit — legal, but per ADR-0003 they then contend for
that bit, which serialises two operations the user expected to run together.
`CLASSICAL_BIT_OUT_OF_RANGE` says exactly what is wrong, and the register's size
control is the fix.

**A measurement is unavailable when no classical register is declared**, because
it would have nowhere to write. This is the case UI.md's `aria-disabled` rule
exists for: announced rather than hidden, since the model supports measurement and
this particular circuit is not ready for one, and those are different statements.

## Placing a Barrier

**A barrier is expanded to every wire in the circuit at placement time**, and
never rewritten afterwards.

This follows from a decision `CircuitModel.md` already made: there is no implicit
"all qubits" barrier, *because its meaning would silently change when a qubit is
added*. Expanding on placement is exactly what an importer does with OpenQASM's
bare `barrier;`, and it leaves the document saying what it means — a barrier over
these wires, which nothing later rewrites.

So a qubit added afterwards is **not** joined to an existing barrier. The
asymmetry with removal is real but principled, and worth stating because it looks
like an oversight:

* **Removing a qubit shrinks a barrier**, because the removed qubit takes its
  reference with it. Leaving it would dangle and `validateCircuit` would report
  `UNKNOWN_QUBIT_REFERENCE`. That shrink is forced by referential integrity — the
  same cleanup that removes gates on the wire — not a policy about barriers.
* **Adding a qubit extends nothing**, because the new wire is referenced by
  nothing and so forces nothing. Extending would be inventing intent.

There is also no way to tell the two cases apart. A barrier over all three qubits
of a three-qubit circuit and a barrier over exactly q0/q1/q2 are byte-identical
documents, so auto-extending could not apply to the first without silently
widening the second — and since barriers constrain scheduling, that would change
the circuit's depth, which is the one thing barriers exist to control.

An explicit "extend to all wires" action on a selected barrier remains available
as a future addition. It is a user-initiated edit, so it has none of these
problems.

---

# Feedback and States

## Violations

The problems strip lists every violation `validateCircuit` returns, each naming
its operation and what is wrong. Selecting one focuses the offending operation on
the canvas; the operation carries a marker badge and an outline.

**Never colour alone.** A violation is carried by the badge, the outline, the
strip entry, and the accessible name — colour is the fourth cue, not the first.

Validation runs after every committed edit and its results are never cached across
one. Violation paths are positional (`operations[3].targets[0]`), and per ADR-0002
positions shift; a violation held past an edit points at the wrong operation.

Transient states during a drag or a pending multi-qubit placement do not surface
violations. Reporting "gate arity mismatch" between the first and second click of
placing a `cx` is technically accurate and useless.

## Empty States

**No qubits** — the canvas shows a prompt to add the first qubit, with the control
adjacent. Never a blank rectangle, and never an empty `role="grid"` either: that
is worse than blank, because `aria-activedescendant` would name a cell that does
not exist. The grid is not rendered at all until there is a wire.

**Qubits but no operations** — wires render with the palette hinted as the next
step. This is a valid circuit (`empty.json`), not an error.

## Save

Saving is explicit — `Ctrl/Cmd` + `S` and a header button — and the header shows
the last saved time. Save is never disabled: saving an unchanged circuit is
harmless, and a disabled control would claim there is nothing worth saving.

Local storage can be unavailable or full, and both must surface. A failed save
shows a persistent, non-blocking banner naming the cause and stating that the
circuit is still in memory. Silence would let a user close the tab believing their
work was safe, and `CLAUDE.md` forbids swallowing the error regardless.

## Opening

The editor opens on whatever local storage restored, and on an empty circuit
otherwise. Three outcomes are distinguished, because collapsing them would either
alarm a first-time user or hide a real loss:

* **Nothing stored** — the ordinary first run. The canvas prompts for a first
  qubit and nothing else is said.
* **A document that cannot be read** — reported, and the editor opens empty beside
  the reason. The likeliest causes are a partial write or a hand edit through
  devtools, and the user is about to build over it.
* **A document from a newer build** — opens correctly, with a warning that parts
  this version does not understand will be dropped on the next save.

**That last warning comes before the first edit, not at save time.** Editing is
what makes the preserved fields unrecoverable — they are keyed to positions the
edit moves, per [ADR-0008](decisions/ADR0008_LocalPersistence.md) section 3 — so
warning at save would be warning after the decision.

Milestone 3 has no backend calls, so backend-unavailable is not an editor state.
The existing status treatment is unchanged.

---

# Visual Language

## Colour

Extends the tokens already in `frontend/src/index.css` — `surface`,
`surface-raised`, `ink`, `ink-muted` — which are defined once and already carry
dark-mode overrides. New tokens follow the same pattern in the same place, and no
component hardcodes a colour.

Gate families are tinted by group, as a **secondary** cue behind the always-present
gate name. Every fill/text pairing meets 4.5:1 in both schemes; oklch is already in
use, which makes holding lightness constant across hues straightforward.

Roles needed for Milestone 3: wire, wire-classical, gate fill per family, control,
barrier, selection, violation, preview.

## Typography and Spacing

One family throughout. Gate glyphs are the one place a monospaced face is used, so
that `rx` and `ry` are distinguishable at 14px and glyph widths stay uniform.
Spacing follows the canvas tokens, so a gate's square and the UI's rhythm agree.

## Motion

Two animations in Milestone 3, both explanatory:

1. **The settle** — an operation moving from its drop position to its derived
   position, as above.
2. **The shift** — inserting a barrier pushing later operations right, so the
   constraint's effect is visible rather than a sudden relayout.

Everything else is instant. `prefers-reduced-motion` removes both and the final
state is identical; nothing is only communicated through movement.

---

# Deliberately Deferred

**To Milestone 4.** The results panel, probability display, state visualization,
and where they sit. The right column is reserved for them and nothing else about
them is designed here — designing a results panel before results exist is the
speculation that kept this document empty through two milestones.

**To Milestone 5.** Responsive and small-screen layout, the full shortcut map
beyond the editor, and import/export affordances. `Roadmap.md` places responsive
layout in Milestone 5; the three-column grid is built so that collapsing it is a
change to the grid rather than to the components.

**Multi-select**, for the reason given under *Selection*.

---

# Rules

* every interaction has a keyboard path
* colour is never the only carrier of meaning
* no component stores a coordinate, a column index, or a copy of the circuit
* animation explains something or does not exist
* inline feedback renders `validateCircuit`'s output and never re-derives it
* the gate list comes from `model/spec.ts`, never from a hand-written array
