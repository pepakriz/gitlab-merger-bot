# GitLab merger bot

[![Build Status](https://travis-ci.org/pepakriz/gitlab-merger-bot.svg)](https://travis-ci.org/pepakriz/gitlab-merger-bot)


## Pre-Installation requirements

#### Get the auth token

1) Create a new account for your bot-user
2) Sign-in to GitLab as bot-user and go to [https://gitlab.com/profile/personal_access_tokens](https://gitlab.com/profile/personal_access_tokens)
3) Add new personal access token with `api` scope

> We strongly recommend using a separate account for bot-user. Don't reuse existing account which can leave the project in future.

#### Setup GitLab repository

1) Make sure that your bot-user has privileges to accept merge requests
2) In `General Settings - Merge Request` section:
	* set `Merge method` to `Fast-forward merge`
	* check `Only allow merge requests to be merged if the pipeline succeeds`


## Usage

#### Running in docker

```bash
docker run -d --name gitlab-merger-bot --restart on-failure \
#	-e GITLAB_URL="https://gitlab.mycompany.com" \
	-e GITLAB_AUTH_TOKEN="<token>" \
	-v "$(pwd)/data":/data \
	pepakriz/gitlab-merger-bot:latest
```

#### Running as a plain JS app

```bash
yarn install
yarn run build
GITLAB_AUTH_TOKEN="<token>" yarn run start
```

#### Configuration options

| Env variable | Default value |  |
|-------------------|--------------------|-------------------|
| `GITLAB_URL` | `https://gitlab.com` | GitLab instance URL  |
| `GITLAB_AUTH_TOKEN` |  | `required` Your GitLab token |
| `CI_CHECK_INTERVAL` | `10` | Time between CI checks (in seconds) |
| `MR_CHECK_INTERVAL` | `20` | Time between merge-requests checks (in second) |
