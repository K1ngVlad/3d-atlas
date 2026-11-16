# Build context: repository root (see deploy/docker-compose.yml).
# Angular CLI requires Node >= 22.12.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
RUN npm ci
COPY angular.json tsconfig.json ./
COPY projects ./projects
RUN npx ng build --configuration production

FROM nginx:1.31.8-alpine AS runtime
COPY projects/app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/dist/app/browser /usr/share/nginx/html
EXPOSE 80
