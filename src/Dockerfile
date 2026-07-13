FROM node:22-alpine AS builder

COPY . /app
COPY tsconfig.json /tsconfig.json

WORKDIR /app

RUN npm install -g pnpm

RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --ignore-scripts

RUN pnpm run build

FROM node:22-alpine AS release

WORKDIR /app

COPY --from=builder /app/build /app/build
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-lock.yaml

ENV NODE_ENV=production

RUN npm install -g pnpm && pnpm install --prod --ignore-scripts

ENTRYPOINT ["node", "build/index.js"]