"""Simulator adapters.

Each adapter implements the same interface: capabilities, statevector
simulation, and sampling.

Rules for every adapter:
  * never import from the API layer
  * never format a response
  * raise typed errors, never simulator-specific exceptions
  * declare its own limits rather than having them imposed

Adding a simulator means adding one adapter and registering it. It must not
require edits elsewhere -- `../registry.py` is that one place.

`qiskit_backend` is the first adapter. It is the **only** module in the project
permitted to import Qiskit, and a test asserts that: the isolation is what
makes the backend swappable, and it is invisible until the day a second one
arrives and a stray import has to be chased down.
"""
