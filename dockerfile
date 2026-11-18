FROM node:24.13.0-alpine3.22

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

RUN corepack enable pnpm \
    && pnpm config set minimumReleaseAge 0 \
    && pnpm install --frozen-lockfile --ignore-scripts

COPY . .