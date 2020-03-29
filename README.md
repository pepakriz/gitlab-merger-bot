# GitLab merger bot

[![Build Status](https://travis-ci.org/pepakriz/gitlab-merger-bot.svg)](https://travis-ci.org/pepakriz/gitlab-merger-bot)

## What does it do?

The goal is to have green master after every merge. To achieve this you have to rebase every single merge request just before the merge and wait for the pipeline status. It takes a lot of time of manual maintenance, especially when you have to process a big chunk of merge requests (common situation for large projects, monorepos etc.). So let's automate it with GitLab MergerBot.

1) When your merge request is ready to merge, assign it to the bot.
2) The bot will add your request to its own serial (FIFO) queue. (single queue for every repository)
3) When your request is on the turn, the bot will rebase the MR and start waiting for the pipeline.
4) When the bot detects some problems with the merge request it'll reassign the merge request back to the author.<br />
Reasons can be for example:
	- Failing pipeline or pipeline awaiting for a manual action
	- The merge request has unresolved discussions
	- The merge request can't be rebased due to conflict

![Assign](https://i.imgur.com/B3Xnpgi.png)
![Merged](https://i.imgur.com/N0WhuOU.png)

## Pre-Installation requirements

#### Get the auth token

1) Create a new account for your bot-user
2) Sign-in to GitLab as bot-user and go to [https://gitlab.com/profile/personal_access_tokens](https://gitlab.com/profile/personal_access_tokens)
3) Add new personal access token with `api` scope

> We strongly recommend using a separate account for bot-user. Don't reuse existing account which can leave the project in the future.

#### Setup GitLab repository

1) Make sure that your bot-user has privileges to accept merge requests
2) In `General Settings - Merge Request` section:
	* set `Merge method` to `Fast-forward merge`
	* check `Only allow merge requests to be merged if the pipeline succeeds`
	* check (optionally) `All discussions must be resolved`


## Usage

#### Running in kubernetes (with HELM)

To add the Helm Chart for your local client, run helm repo add:

```bash
helm repo add gitlab-merger-bot https://pepakriz.github.io/gitlab-merger-bot
```

And install it:

```bash
helm install --name gitlab-merger-bot gitlab-merger-bot \
#	--set settings.gitlabUrl="https://gitlab.mycompany.com" \
	--set settings.authToken="<token>"
```

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
| `MR_CHECK_INTERVAL` | `20` | Time between merge-requests checks (in seconds) |
| `REMOVE_BRANCH_AFTER_MERGE` | `true` | It'll remove branch after merge |
| `SQUASH_MERGE_REQUEST` | `true` | It'll squash commits on merge |
| `SKIP_SQUASHING_LABEL` | `bot:skip-squash` | It'll skip squash when MR contains this label |
| `HI_PRIORITY_LABEL` | `bot:hi-priority` | It'll put MR with this label to the beginning of the queue |
