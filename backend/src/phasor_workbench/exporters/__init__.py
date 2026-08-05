"""Circuit exporters.

OpenQASM 2.0 is in `qasm.py`. JSON is not here and will not be: a Circuit Model
document *is* JSON, so writing one is `serialization/`'s job rather than a format
conversion -- which is why the frontend can do JSON alone and cannot do OpenQASM.
ProjectStructure.md relabelled this directory from "OpenQASM, JSON in/out" to
foreign formats for that reason.

The prediction this docstring carried from Milestone 1 -- that gate names in the
Circuit Model already following OpenQASM convention would keep the translation
thin -- held: the exporter maps two names and writes the rest unchanged.
"""
