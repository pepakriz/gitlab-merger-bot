FROM node:12.16.1-alpine AS build
WORKDIR /app

COPY ./package.json ./yarn.lock ./schema.graphql ./codegen.yml ./

RUN set -ex \
	&& yarn install

COPY ./ ./

RUN set -ex \
	&& yarn run build \
	&& yarn run build-bin


FROM node:12.16.1-alpine AS dashboard-build
WORKDIR /app/dashboard

COPY ./dashboard/package.json ./dashboard/yarn.lock ./
COPY ./schema.graphql ./codegen.yml ../

# We run yarn install with an increased network timeout (5min) to avoid "ESOCKETTIMEDOUT" errors from hub.docker.com
# See, for example https://github.com/yarnpkg/yarn/issues/5540
RUN set -ex \
	&& yarn install --network-timeout 300000

COPY ./dashboard ./

RUN set -ex \
	&& yarn run build \
	&& yarn run export


FROM alpine:3.11
WORKDIR /app
CMD ["/app/gitlab-merger-bot"]
ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN set -ex \
	&& apk --no-cache --update add \
		ca-certificates \
		libstdc++ \
		libgcc \
	&& mkdir -p /data

COPY --from=build /app/gitlab-merger-bot /app/schema.graphql /app/
COPY --from=dashboard-build /app/dashboard/out /app/dashboard/out/
