FROM node:12.13.0-alpine AS build
WORKDIR /app

COPY ./package.json ./yarn.lock ./

RUN set -ex \
	&& yarn install

COPY ./ /app

RUN set -ex \
	&& yarn run build \
	&& yarn run build-bin

FROM alpine:3.8
CMD ["/bin/gitlab-merger-bot"]
ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN set -ex \
	&& apk --no-cache --update add \
		ca-certificates \
		libstdc++ \
		libgcc \
	&& mkdir -p /data

COPY --from=build /app/gitlab-merger-bot /bin/
