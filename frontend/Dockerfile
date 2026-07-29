# syntax=docker/dockerfile:1

# Node 22 matches both the host and the CI ceiling.
FROM node:22-slim AS base

WORKDIR /app


# --- Development ---------------------------------------------------------
#
# The working tree is bind-mounted over /app by compose, with an anonymous
# volume preserving the node_modules installed here. Without that volume the
# mount would hide them and every import would fail.

FROM base AS development

# Manifests first, so editing source does not invalidate the install layer.
COPY package.json package-lock.json ./

# `npm ci` installs strictly from the lockfile, matching what CI does.
RUN npm ci

COPY . .

EXPOSE 5173

# --host binds 0.0.0.0. Vite defaults to loopback, which inside a container
# is unreachable from the host. Passed here rather than set in
# vite.config.ts so native development keeps binding loopback only.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
