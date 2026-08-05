// name: Quantum Fourier Transform
// summary: The transform behind phase estimation and Shor's algorithm. It maps a basis state to a pattern of phases rather than to another basis state.
OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];

// Written most-significant qubit first, which here is q[2]: this project fixes
// qubit 0 as the RIGHTMOST bit of a basis string, the opposite of the textbook
// diagram. Building it the textbook way transforms the bit-reversed input and
// is wrong for every input but zero.
//
// The model has no controlled-phase gate, so each one is written out as
// p, cx, p, cx, p -- exact, not an approximation.
h q[2];

// controlled-p(pi/2), control q[1], target q[2]
p(pi/4) q[1];
cx q[1],q[2];
p(-pi/4) q[2];
cx q[1],q[2];
p(pi/4) q[2];

// controlled-p(pi/4), control q[0], target q[2]
p(pi/8) q[0];
cx q[0],q[2];
p(-pi/8) q[2];
cx q[0],q[2];
p(pi/8) q[2];

h q[1];

// controlled-p(pi/2), control q[0], target q[1]
p(pi/4) q[0];
cx q[0],q[1];
p(-pi/4) q[1];
cx q[0],q[1];
p(pi/4) q[1];

h q[0];

// The transform leaves the result bit-reversed; the swap undoes it.
swap q[0],q[2];
