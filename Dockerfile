FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_ROOT=/data
ENV SERVER_HOST=127.0.0.1
ENV SERVER_PORT=3001

RUN mkdir -p /data
RUN apk add --no-cache git openssh-client

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/data/example-config.json ./data/example-config.json
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/lib ./src/lib
RUN mkdir -p public

EXPOSE 3000

CMD ["npm", "run", "start"]
