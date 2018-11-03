# GitLab merger bot

[![Build Status](https://travis-ci.org/pepakriz/gitlab-merger-bot.svg)](https://travis-ci.org/pepakriz/gitlab-merger-bot)

## Usage

### Running in docker

```bash
docker run -d --name gitlab-merger-bot --restart on-failure \
#	-e GITLAB_URL="https://gitlab.mycompany.com" \
	-e GITLAB_AUTH_TOKEN="<token>" \
	-v "$(pwd)/data":/data \
	pepakriz/gitlab-merger-bot:latest
```

### Running as a plain JS app

```bash
yarn install
yarn run build
GITLAB_AUTH_TOKEN="<token>" yarn run start
```

#### How to get the auth token

1) Sig-in to GitLab and go to [https://gitlab.com/profile/personal_access_tokens](https://gitlab.com/profile/personal_access_tokens)
2) Add new personal access token with `api` scope

### Configuration options

| Env variable | Default value |  |
|-------------------|--------------------|-------------------|
| GITLAB_URL | https://gitlab.com | GitLab instance URL  |
| GITLAB_AUTH_TOKEN |  | `required` Your GitLab token |
| CI_CHECK_INTERVAL | 10 | Time between CI checks (in seconds) |
| MR_CHECK_INTERVAL | 20 | Time between merge-requests checks (in second) |
