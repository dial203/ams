# Staff web app: static build served by nginx, which also forwards /api to the `api` container.
# Build from the repository root:
#   docker build -f web/Dockerfile .                                            # same-origin API (default)
#   docker build -f web/Dockerfile --build-arg VITE_API_URL=https://api.example.org .   # API elsewhere
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@ams/web..."
ARG VITE_API_URL=/
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm --filter @ams/web exec vite build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 80
