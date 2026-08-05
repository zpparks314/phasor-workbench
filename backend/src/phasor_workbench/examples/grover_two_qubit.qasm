// name: Grover Search
// summary: Finds the one marked item among four with a single query, where checking them one at a time would average two or three.
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg meas[2];

h q[0];
h q[1];

barrier q[0],q[1];
// The oracle flips the phase of |11>, the marked state.
cz q[0],q[1];
barrier q[0],q[1];

// Diffusion: reflect about the average. One round is exact for two qubits.
h q[0];
h q[1];
x q[0];
x q[1];
cz q[0],q[1];
x q[0];
x q[1];
h q[0];
h q[1];

measure q[0] -> meas[0];
measure q[1] -> meas[1];
