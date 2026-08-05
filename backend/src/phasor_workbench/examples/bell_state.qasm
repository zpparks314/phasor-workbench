// name: Bell State
// summary: The simplest entangled pair. Measuring either qubit is a coin flip, but the two always agree.
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg meas[2];

// A Hadamard puts q[0] into an equal superposition, then the cx copies that
// choice onto q[1]. Neither qubit has a state of its own afterwards.
h q[0];
cx q[0],q[1];

barrier q[0],q[1];
measure q[0] -> meas[0];
measure q[1] -> meas[1];
