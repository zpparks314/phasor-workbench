// name: Bernstein-Vazirani
// summary: Recovers a hidden bit string in a single query, where guessing bit by bit would take one query each. The secret here is 101.
OPENQASM 2.0;
include "qelib1.inc";
qreg q[4];
creg meas[3];

x q[3];
h q[3];
h q[0];
h q[1];
h q[2];

barrier q[0],q[1],q[2],q[3];
// One cx per set bit of the secret. Qubit 0 is the rightmost bit, so 101
// means q[0] and q[2].
cx q[0],q[3];
cx q[2],q[3];
barrier q[0],q[1],q[2],q[3];

h q[0];
h q[1];
h q[2];
measure q[0] -> meas[0];
measure q[1] -> meas[1];
measure q[2] -> meas[2];
