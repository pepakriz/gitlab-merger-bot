FROM node:12.16.1-alpine AS base
WORKDIR /app

COPY ./package.json ./yarn.lock ./
COPY ./server/package.json ./server/
COPY ./dashboard/package.json ./dashboard/
COPY ./common/package.json ./common/

# We run yarn install with an increased network timeout (5min) to avoid "ESOCKETTIMEDOUT" errors from hub.docker.com
# See, for example https://github.com/yarnpkg/yarn/issues/5540
RUN set -ex \
	&& yarn install --network-timeout 300000

COPY ./schema.graphql ./


FROM base AS server-build
WORKDIR /app/server

COPY ./server/codegen.yml ./

RUN set -ex \
	&& yarn run generate

COPY ./server ./

RUN set -ex \
	&& yarn run build \
	&& yarn run build-bin


FROM base AS dashboard-build
WORKDIR /app/dashboard

COPY ./dashboard ./

RUN set -ex \
	# because it needs src
	&& yarn run generate \
	&& yarn run build \
	&& yarn run export


FROM alpine:3.11
WORKDIR /app
CMD ["/app/server/gitlab-merger-bot"]
ENV NODE_ENV=production

RUN set -ex \
	&& apk --no-cache --update add \
		ca-certificates \
		libstdc++ \
		libgcc

COPY --from=server-build /app/server/gitlab-merger-bot /app/server/
COPY --from=dashboard-build /app/dashboard/out /app/dashboard/out/
