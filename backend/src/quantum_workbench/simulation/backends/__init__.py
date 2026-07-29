"""Simulator adapters.

Each adapter implements the same interface: capabilities, statevector
simulation, and sampling.

Rules for every adapter:
  * never import from the API layer
  * never format a response
  * raise typed errors, never simulator-specific exceptions
  * declare its own limits rather than having them imposed

Adding a simulator means adding one adapter and registering it. It must not
require edits elsewhere.

Empty until Milestone 4. Qiskit is the first planned adapter.
"""
