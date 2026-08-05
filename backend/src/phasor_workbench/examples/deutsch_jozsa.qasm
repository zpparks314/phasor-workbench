// name: Deutsch-Jozsa
// summary: Decides whether a hidden function is constant or balanced in one query. This oracle is balanced, so the answer is never 00.
OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg meas[2];

// q[2] is the oracle's answer qubit, put into |-> so that a phase kicks back
// onto the inputs rather than changing the answer qubit itself.
x q[2];
h q[2];
h q[0];
h q[1];

barrier q[0],q[1],q[2];
// The oracle: f(x) = x0 XOR x1, which is balanced.
cx q[0],q[2];
cx q[1],q[2];
barrier q[0],q[1],q[2];

h q[0];
h q[1];
measure q[0] -> meas[0];
measure q[1] -> meas[1];
