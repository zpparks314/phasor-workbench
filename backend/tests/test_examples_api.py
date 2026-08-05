"""The example endpoints' transport.

What the examples contain is `test_examples.py`'s job. What matters here is the
wire shape, and that a circuit handed back can go straight into another endpoint
without a translation step -- which is the whole reason the catalogue serves
Circuit Model documents rather than OpenQASM source.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

EXAMPLES = "/api/v1/examples"


class TestCatalogue:
    def test_lists_every_example_in_camel_case(self, client: TestClient) -> None:
        response = client.get(EXAMPLES)

        assert response.status_code == 200
        entries = response.json()["examples"]
        assert len(entries) >= 6

        first = entries[0]
        # camelCase on the wire, one convention across the API rather than one
        # per endpoint.
        assert set(first) == {
            "id",
            "name",
            "summary",
            "qubitCount",
            "operationCount",
        }

    def test_carries_no_circuits(self, client: TestClient) -> None:
        """ADR-0009 section 3: the list is metadata, circuits are fetched.

        Bundling them would save a round trip and would not survive a generated
        entry, which has no single circuit to bundle.
        """
        entries = client.get(EXAMPLES).json()["examples"]

        assert all("circuit" not in entry for entry in entries)

    def test_is_ordered_the_same_way_every_time(self, client: TestClient) -> None:
        first = [e["id"] for e in client.get(EXAMPLES).json()["examples"]]
        second = [e["id"] for e in client.get(EXAMPLES).json()["examples"]]

        assert first == second == sorted(first)

    def test_counts_describe_the_circuit(self, client: TestClient) -> None:
        """Computed rather than declared, so they cannot disagree with it."""
        entry = next(
            e
            for e in client.get(EXAMPLES).json()["examples"]
            if e["id"] == "bell-state"
        )
        circuit = client.get(f"{EXAMPLES}/bell-state").json()["circuit"]

        assert entry["qubitCount"] == len(circuit["qubits"])
        assert entry["operationCount"] == len(circuit["operations"])


class TestOneExample:
    def test_returns_a_circuit_the_other_endpoints_accept(
        self, client: TestClient
    ) -> None:
        response = client.get(f"{EXAMPLES}/bell-state")
        assert response.status_code == 200

        circuit = response.json()["circuit"]
        analysis = client.post("/api/v1/circuits/analyze", json={"circuit": circuit})

        assert analysis.status_code == 200
        assert analysis.json()["qubitCount"] == 2

    def test_round_trips_through_qasm_export(self, client: TestClient) -> None:
        """An example was authored as OpenQASM, so it must survive going back."""
        circuit = client.get(f"{EXAMPLES}/ghz-state").json()["circuit"]

        exported = client.post(
            "/api/v1/circuits/export/qasm", json={"circuit": circuit}
        )
        assert exported.status_code == 200

        reimported = client.post(
            "/api/v1/circuits/import/qasm",
            json={"source": exported.json()["source"]},
        )
        assert reimported.status_code == 200
        assert reimported.json()["circuit"]["operations"] == circuit["operations"]

    def test_an_unknown_id_is_not_found(self, client: TestClient) -> None:
        response = client.get(f"{EXAMPLES}/no-such-example")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"

    def test_every_listed_example_can_be_fetched(self, client: TestClient) -> None:
        """The failure a manifest would have introduced, asserted against."""
        for entry in client.get(EXAMPLES).json()["examples"]:
            assert client.get(f"{EXAMPLES}/{entry['id']}").status_code == 200
