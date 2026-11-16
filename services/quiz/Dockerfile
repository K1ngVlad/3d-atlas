FROM node:22-alpine AS build
WORKDIR /app
COPY services/quiz/package.json services/quiz/package-lock.json ./
RUN npm ci
COPY services/quiz/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
