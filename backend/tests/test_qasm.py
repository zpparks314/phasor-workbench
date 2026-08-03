"""The OpenQASM 2.0 parser.

Sources are written inline rather than kept as files, because a parser test is
only readable when the input sits beside the expectation. The shared fixtures in
`shared/fixtures/` stay for things both languages implement; nothing in the
frontend parses QASM, so there is no contract here to hold two implementations
to.

**The parser's output is asserted through the loader, not instead of it.** A
test that checked the document dictionary directly would pass on a document the
real loader rejects, which is exactly the divergence the design avoids by
producing a document rather than a `Circuit`.
"""

from __future__ import annotations

import math

import pytest

from phasor_workbench.importers.qasm import QasmError, QasmErrorCode, parse_qasm
from phasor_workbench.importers.qasm.gates import ALIASES, model_gate
from phasor_workbench.importers.qasm.tokens import TokenKind, tokenize
from phasor_workbench.models.circuit import (
    Circuit,
    GateOperation,
    MeasurementOperation,
)
from phasor_workbench.models.spec import GATE_SIGNATURES, ViolationCode
from phasor_workbench.serialization import LoadFailure, load_circuit
from phasor_workbench.validation import validate_circuit

HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n'


def circuit(source: str) -> Circuit:
    """Parse, load and validate, asserting the whole path succeeded."""
    result = parse_qasm(source)
    assert result.problems == [], result.problems

    outcome = load_circuit(result.document)
    assert not isinstance(outcome, LoadFailure), outcome.violations

    assert validate_circuit(outcome.circuit).errors == ()
    return outcome.circuit


def codes(source: str) -> list[str]:
    """Every problem code a source reports, without raising."""
    return [problem.code for problem in parse_qasm(source).problems]


def gate_at(parsed: Circuit, index: int) -> GateOperation:
    """Narrow one operation to a gate, asserting that is what it is.

    The operation union is discriminated, so reaching for `.controls` on it
    needs narrowing anyway -- doing it here makes the assertion explicit rather
    than leaving a cast at every call site.
    """
    operation = parsed.operations[index]
    assert isinstance(operation, GateOperation), operation
    return operation


def measurement_at(parsed: Circuit, index: int) -> MeasurementOperation:
    operation = parsed.operations[index]
    assert isinstance(operation, MeasurementOperation), operation
    return operation


class TestTokenizer:
    def test_tracks_line_and_column(self) -> None:
        tokens = tokenize("OPENQASM 2.0;\nqreg q[2];")
        qreg = next(token for token in tokens if token.text == "qreg")

        assert (qreg.line, qreg.column) == (2, 1)

    def test_skips_line_comments(self) -> None:
        tokens = tokenize("// a comment\nqreg")

        assert [t.text for t in tokens if t.kind is not TokenKind.EOF] == ["qreg"]

    def test_reads_arrow_as_one_token(self) -> None:
        # `-` then `>` would make `measure q -> c` unparseable, and the failure
        # would surface far from here.
        assert next(t.text for t in tokenize("->")) == "->"

    def test_reads_reals_and_exponents(self) -> None:
        kinds = {t.text: t.kind for t in tokenize("1 1.5 1e3 1.5e-2")}

        assert kinds["1"] is TokenKind.INTEGER
        assert kinds["1.5"] is TokenKind.REAL
        assert kinds["1e3"] is TokenKind.REAL
        assert kinds["1.5e-2"] is TokenKind.REAL

    def test_refuses_an_unknown_character(self) -> None:
        with pytest.raises(QasmError) as caught:
            tokenize("qreg q@2;")

        assert caught.value.problem.code == QasmErrorCode.QASM_SYNTAX_ERROR


class TestParameterExpressions:
    @pytest.mark.parametrize(
        ("expression", "expected"),
        [
            ("pi", math.pi),
            ("pi/2", math.pi / 2),
            ("2*pi/3", 2 * math.pi / 3),
            ("-pi/4", -math.pi / 4),
            ("1+2*3", 7.0),
            ("(1+2)*3", 9.0),
            ("2^3^2", 512.0),
            ("sqrt(4)", 2.0),
            ("cos(0)", 1.0),
            ("0.5", 0.5),
        ],
    )
    def test_evaluates(self, expression: str, expected: float) -> None:
        parsed = circuit(f"{HEADER}qreg q[1];\nrz({expression}) q[0];")

        assert gate_at(parsed, 0).parameters["theta"] == pytest.approx(expected)

    def test_precedence_is_not_left_to_right(self) -> None:
        # 1+2*3 is 7, not 9. A parser that ignored precedence would give 9 and
        # every rotation in every imported file would be quietly wrong.
        parsed = circuit(f"{HEADER}qreg q[1];\nrz(1+2*3) q[0];")

        assert gate_at(parsed, 0).parameters["theta"] == pytest.approx(7.0)

    def test_refuses_division_by_zero(self) -> None:
        with pytest.raises(QasmError) as caught:
            parse_qasm(f"{HEADER}qreg q[1];\nrz(1/0) q[0];")

        assert caught.value.problem.code == QasmErrorCode.QASM_SYNTAX_ERROR


class TestGateMapping:
    def test_aliases_resolve(self) -> None:
        assert model_gate("id") is not None
        assert model_gate("u1") is not None

    def test_every_model_gate_is_reachable_by_its_own_name(self) -> None:
        # The mapping is by signature, not by a hand-written table, so a gate
        # added to circuit.spec.json must import with no change here. This is
        # what would catch someone adding one and quietly breaking that.
        unreachable = [
            gate.value
            for gate in GATE_SIGNATURES
            if model_gate(gate.value) is None and gate.value not in ALIASES.values()
        ]

        assert unreachable == []

    def test_refuses_gates_the_model_cannot_hold(self) -> None:
        for name in ("u3", "u2", "ch", "crz", "cu1", "cu3", "cswap"):
            assert model_gate(name) is None, name

    def test_an_unsupported_gate_reports_the_model_code(self) -> None:
        assert codes(f"{HEADER}qreg q[1];\nu3(0,0,0) q[0];") == [
            ViolationCode.UNKNOWN_GATE_NAME
        ]


class TestRegisters:
    def test_quantum_registers_flatten_into_one_indexed_list(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[2];\nqreg r[3];")

        assert [qubit.index for qubit in parsed.qubits] == [0, 1, 2, 3, 4]

    def test_a_classical_register_keeps_its_name_as_a_label(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[1];\ncreg result[3];")

        assert parsed.classical_registers[0].size == 3
        assert parsed.classical_registers[0].label == "result"

    def test_several_classical_registers_map_one_for_one(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[1];\ncreg a[1];\ncreg b[2];")

        assert [register.size for register in parsed.classical_registers] == [1, 2]

    def test_refuses_a_duplicate_declaration(self) -> None:
        assert codes(f"{HEADER}qreg q[1];\nqreg q[2];") == [
            QasmErrorCode.QASM_DUPLICATE_REGISTER
        ]

    def test_reports_an_undeclared_register(self) -> None:
        assert codes(f"{HEADER}qreg q[1];\nh z[0];") == [
            QasmErrorCode.QASM_UNKNOWN_REGISTER
        ]

    def test_reports_an_index_past_the_end(self) -> None:
        assert codes(f"{HEADER}qreg q[2];\nh q[5];") == [
            QasmErrorCode.QASM_INDEX_OUT_OF_RANGE
        ]


class TestBroadcast:
    def test_a_bare_register_applies_once_per_qubit(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[3];\nh q;")

        assert len(parsed.operations) == 3
        assert [op.targets[0] for op in parsed.operations] == [
            q.id for q in parsed.qubits
        ]

    def test_two_registers_pair_up(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[2];\nqreg r[2];\ncx q,r;")

        assert len(parsed.operations) == 2
        assert gate_at(parsed, 0).controls == [parsed.qubits[0].id]
        assert gate_at(parsed, 0).targets == [parsed.qubits[2].id]

    def test_a_single_qubit_repeats_across_a_register(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[1];\nqreg r[3];\ncx q[0],r;")

        assert len(parsed.operations) == 3
        controls = {gate_at(parsed, i).controls[0] for i in range(3)}
        assert controls == {parsed.qubits[0].id}

    def test_refuses_registers_of_different_sizes(self) -> None:
        assert codes(f"{HEADER}qreg q[2];\nqreg r[3];\ncx q,r;") == [
            QasmErrorCode.QASM_BROADCAST_MISMATCH
        ]


class TestControlsAndTargets:
    def test_cx_reads_control_first(self) -> None:
        # OpenQASM writes `cx control, target`. Getting this backwards produces
        # a circuit that simulates cleanly and is wrong, which is the worst
        # kind of bug this parser could have.
        parsed = circuit(f"{HEADER}qreg q[2];\ncx q[0],q[1];")
        operation = gate_at(parsed, 0)

        assert operation.controls == [parsed.qubits[0].id]
        assert operation.targets == [parsed.qubits[1].id]

    def test_ccx_takes_two_controls(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[3];\nccx q[0],q[1],q[2];")
        operation = gate_at(parsed, 0)

        assert operation.controls == [parsed.qubits[0].id, parsed.qubits[1].id]
        assert operation.targets == [parsed.qubits[2].id]

    def test_swap_takes_two_targets_and_no_control(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[2];\nswap q[0],q[1];")
        operation = gate_at(parsed, 0)

        assert operation.controls == []
        assert len(operation.targets) == 2

    def test_reports_the_wrong_number_of_qubits(self) -> None:
        assert codes(f"{HEADER}qreg q[2];\ncx q[0];") == [
            QasmErrorCode.QASM_ARGUMENT_COUNT
        ]

    def test_reports_the_wrong_number_of_parameters(self) -> None:
        assert codes(f"{HEADER}qreg q[1];\nrx q[0];") == [
            QasmErrorCode.QASM_PARAMETER_COUNT
        ]


class TestBarrier:
    def test_a_bare_barrier_expands_to_every_qubit(self) -> None:
        # The answer Roadmap.md recorded before this parser existed, and the
        # schema states it too: there is no implicit all-qubits barrier, so an
        # importer has to expand one.
        parsed = circuit(f"{HEADER}qreg q[2];\nqreg r[2];\nbarrier;")

        assert len(parsed.operations) == 1
        assert parsed.operations[0].targets == [q.id for q in parsed.qubits]

    def test_a_named_register_barriers_all_of_it(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[3];\nbarrier q;")

        assert len(parsed.operations) == 1
        assert len(parsed.operations[0].targets) == 3

    def test_listed_qubits_barrier_only_those(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[3];\nbarrier q[0],q[2];")

        assert parsed.operations[0].targets == [
            parsed.qubits[0].id,
            parsed.qubits[2].id,
        ]

    def test_a_barrier_does_not_broadcast(self) -> None:
        # One barrier across the register, not one barrier per qubit -- the
        # opposite of how a gate treats the same syntax.
        parsed = circuit(f"{HEADER}qreg q[3];\nbarrier q;")

        assert len(parsed.operations) == 1

    def test_a_bare_barrier_with_no_qubits_emits_nothing(self) -> None:
        # A barrier with empty targets is not a legal operation, so emitting
        # one would produce a document the loader refuses.
        assert circuit(f"{HEADER}barrier;").operations == []


class TestMeasurement:
    def test_maps_onto_a_register_and_bit(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[1];\ncreg c[1];\nmeasure q[0] -> c[0];")
        target = measurement_at(parsed, 0).classical_target

        # `register_`, not `register`: the generated Python name is suffixed
        # and aliased back on the wire. Roadmap.md's Open Issues records it as
        # cosmetic and confined to the Python API, and this is where that costs
        # something -- the document the parser builds spells it `register`.
        assert target.register_ == parsed.classical_registers[0].id
        assert target.bit == 0

    def test_broadcasts_pairwise(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[2];\ncreg c[2];\nmeasure q -> c;")

        assert [measurement_at(parsed, i).classical_target.bit for i in (0, 1)] == [
            0,
            1,
        ]

    def test_refuses_a_size_mismatch(self) -> None:
        assert codes(f"{HEADER}qreg q[2];\ncreg c[1];\nmeasure q -> c;") == [
            QasmErrorCode.QASM_BROADCAST_MISMATCH
        ]

    def test_a_gate_after_a_measurement_fails_the_real_validator(self) -> None:
        # Not a parse error. The parser produces a document, the model's own
        # validator refuses it, and the code the user sees is the model's.
        result = parse_qasm(
            f"{HEADER}qreg q[1];\ncreg c[1];\nmeasure q[0] -> c[0];\nh q[0];"
        )
        assert result.problems == []

        outcome = load_circuit(result.document)
        assert not isinstance(outcome, LoadFailure)

        errors = validate_circuit(outcome.circuit).errors
        assert [error.code for error in errors] == [
            ViolationCode.OPERATION_AFTER_MEASUREMENT
        ]


class TestUnsupportedStatements:
    @pytest.mark.parametrize(
        "statement",
        [
            "gate mine(a) x { rx(a) x; }",
            "opaque mine(a) x;",
            "if (c==1) h q[0];",
            "reset q[0];",
        ],
    )
    def test_are_refused_rather_than_dropped(self, statement: str) -> None:
        # Dropping any of these silently would return a circuit that does
        # something different from the file the user handed over.
        source = f"{HEADER}qreg q[1];\ncreg c[1];\n{statement}"

        assert QasmErrorCode.QASM_UNSUPPORTED_STATEMENT in codes(source)

    def test_a_gate_body_is_skipped_whole(self) -> None:
        # Resynchronising at the next `;` would stop inside the braces and read
        # the body as top-level statements, inventing problems that are not
        # there. Exactly one problem is the assertion that it did not.
        source = f"{HEADER}qreg q[1];\ngate mine(a) x {{ rx(a) x; h x; }}\nh q[0];"

        assert codes(source) == [QasmErrorCode.QASM_UNSUPPORTED_STATEMENT]


class TestProgramStructure:
    def test_requires_the_header(self) -> None:
        with pytest.raises(QasmError) as caught:
            parse_qasm("qreg q[1];")

        assert caught.value.problem.code == QasmErrorCode.QASM_SYNTAX_ERROR

    def test_refuses_openqasm_3(self) -> None:
        with pytest.raises(QasmError) as caught:
            parse_qasm("OPENQASM 3.0;\nqubit[2] q;")

        assert caught.value.problem.code == QasmErrorCode.QASM_VERSION_UNSUPPORTED

    def test_a_syntax_error_carries_its_position(self) -> None:
        with pytest.raises(QasmError) as caught:
            parse_qasm(f"{HEADER}qreg q[1]\n")

        problem = caught.value.problem
        assert problem.line == 4
        assert problem.location == f"line {problem.line}, column {problem.column}"

    def test_collects_every_semantic_problem_in_one_pass(self) -> None:
        # The behaviour api/documents.py already refuses to compromise on: a
        # user fixing a file should not do it one round trip at a time.
        source = f"{HEADER}qreg q[1];\nu3(0,0,0) q[0];\nh z[0];\nh q[9];"

        assert codes(source) == [
            ViolationCode.UNKNOWN_GATE_NAME,
            QasmErrorCode.QASM_UNKNOWN_REGISTER,
            QasmErrorCode.QASM_INDEX_OUT_OF_RANGE,
        ]

    def test_an_empty_program_is_a_valid_empty_circuit(self) -> None:
        assert circuit(HEADER).qubits == []


class TestWholeCircuits:
    def test_a_bell_state(self) -> None:
        parsed = circuit(
            f"{HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;"
        )

        assert [op.kind for op in parsed.operations] == [
            "gate",
            "gate",
            "measurement",
            "measurement",
        ]

    def test_identifiers_are_unique(self) -> None:
        parsed = circuit(f"{HEADER}qreg q[3];\ncreg c[3];\nh q;\nmeasure q -> c;")
        identifiers = (
            [q.id for q in parsed.qubits]
            + [r.id for r in parsed.classical_registers]
            + [op.id for op in parsed.operations]
        )

        assert len(identifiers) == len(set(identifiers))
