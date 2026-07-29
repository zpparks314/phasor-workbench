# Frontend

React + TypeScript + Vite + Tailwind.

**Status:** foundation only. No circuit features are implemented.

---

## Setup

Requires Node 20.19+ (not currently installed on this machine).

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The dev server runs on `http://localhost:5173` and proxies `/api` to the
backend on `http://localhost:8000`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check and produce a production build |
| `npm test` | Run tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run typecheck` | TypeScript, no emit |

## Layout

```text
src/
├── api/            API client -- the only place that calls fetch
├── components/     Shared presentational components  (Milestone 3)
├── editor/         Circuit editor, SVG rendering      (Milestone 3)
├── visualization/  State visualization                (Milestone 4)
├── state/          Circuit state, undo/redo           (Milestone 3)
└── test/           Test setup
```

## Rendering Decision

Circuit rendering uses **direct SVG**, not a node-graph library.

A circuit is a grid of fixed wire lanes with gates at discrete
`(qubit, column)` positions — not free-positioned nodes with edges. Node-graph
libraries own node coordinates, which would duplicate layout that
[CircuitModel.md](../docs/CircuitModel.md) requires to be *derived* from the
model. SVG also gives the control the educational visualizations need later.

## Rules

* never implement simulation logic here
* never call `fetch` outside `src/api/`
* never store a second copy of the circuit
* the app must degrade gracefully when the backend is unavailable
