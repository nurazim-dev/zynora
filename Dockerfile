FROM node:22-alpine AS dependencies
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=dependencies /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY server.js ./server.js
COPY config ./config
COPY middlewares ./middlewares
COPY routes ./routes
COPY scripts ./scripts
COPY services ./services
COPY validators ./validators
COPY html ./html
COPY css ./css
COPY image ./image
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
