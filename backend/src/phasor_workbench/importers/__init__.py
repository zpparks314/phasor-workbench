"""Circuit importers.

Importers produce Circuit Model **documents** and never bypass validation. That
sentence predates the first importer and turned out to be the whole design: an
importer that built `Circuit` objects directly would be a second way into the
model, and the first thing to diverge would be whatever the loader checks that
the importer forgot.

`qasm/` reads OpenQASM 2.0, and lands here rather than in a top-level package
because this is where the structure reserved it. Its counterpart writer belongs
in `exporters/`; the two share only a two-entry alias table, which is not enough
coupling to justify one package spanning both directions.

JSON needs no importer. A Circuit Model document *is* JSON, so reading one is
`serialization/`'s versioned loader rather than a format conversion -- which is
why the frontend can do it alone and QASM cannot.
"""
