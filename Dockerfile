FROM node:10.12.0-alpine AS build
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

RUN set -ex \
	&& apk --no-cache --update add \
		git \
		ca-certificates \
		libstdc++ \
		libgcc

COPY --from=build /app/gitlab-merger-bot /bin/
