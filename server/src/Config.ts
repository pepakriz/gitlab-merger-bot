import * as env from 'env-var';

export const defaultConfig = {
	GITLAB_URL: 'https://gitlab.com',
	GITLAB_AUTH_TOKEN: '',
	CI_CHECK_INTERVAL: 5,
	MR_CHECK_INTERVAL: 20,
	REMOVE_BRANCH_AFTER_MERGE: true,
	SQUASH_MERGE_REQUEST: true,
	PREFER_GITLAB_TEMPLATE: false,
	AUTORUN_MANUAL_BLOCKING_JOBS: true,
	SKIP_SQUASHING_LABEL: 'bot:skip-squash',
	HIGH_PRIORITY_LABEL: 'bot:high-priority',
	HTTP_SERVER_ENABLE: false,
	HTTP_SERVER_PORT: 4000,
	WEB_HOOK_TOKEN: '',
	DRY_RUN: false,
	HTTP_PROXY: '',
};

export const getConfig = (): Config => ({
	GITLAB_URL: env
		.get('GITLAB_URL')
		.default(defaultConfig.GITLAB_URL)
		.asUrlString()
		.replace(/\/$/g, ''),
	GITLAB_AUTH_TOKEN: env.get('GITLAB_AUTH_TOKEN').required().asString(),
	CI_CHECK_INTERVAL:
		env.get('CI_CHECK_INTERVAL').default(`${defaultConfig.CI_CHECK_INTERVAL}`).asIntPositive() *
		1000,
	MR_CHECK_INTERVAL:
		env.get('MR_CHECK_INTERVAL').default(`${defaultConfig.MR_CHECK_INTERVAL}`).asIntPositive() *
		1000,
	REMOVE_BRANCH_AFTER_MERGE: env
		.get('REMOVE_BRANCH_AFTER_MERGE')
		.default(`${defaultConfig.REMOVE_BRANCH_AFTER_MERGE}`)
		.asBoolStrict(),
	SQUASH_MERGE_REQUEST: env
		.get('SQUASH_MERGE_REQUEST')
		.default(`${defaultConfig.SQUASH_MERGE_REQUEST}`)
		.asBoolStrict(),
	PREFER_GITLAB_TEMPLATE: env
		.get('PREFER_GITLAB_TEMPLATE')
		.default(`${defaultConfig.PREFER_GITLAB_TEMPLATE}`)
		.asBoolStrict(),
	AUTORUN_MANUAL_BLOCKING_JOBS: env
		.get('AUTORUN_MANUAL_BLOCKING_JOBS')
		.default(`${defaultConfig.AUTORUN_MANUAL_BLOCKING_JOBS}`)
		.asBoolStrict(),
	SKIP_SQUASHING_LABEL: env
		.get('SKIP_SQUASHING_LABEL')
		.default(defaultConfig.SKIP_SQUASHING_LABEL)
		.asString(),
	HIGH_PRIORITY_LABEL: env
		.get('HIGH_PRIORITY_LABEL')
		.default(defaultConfig.HIGH_PRIORITY_LABEL)
		.asString(),
	HTTP_SERVER_ENABLE: env
		.get('HTTP_SERVER_ENABLE')
		.default(`${defaultConfig.HTTP_SERVER_ENABLE}`)
		.asBoolStrict(),
	HTTP_SERVER_PORT: env
		.get('HTTP_SERVER_PORT')
		.default(`${defaultConfig.HTTP_SERVER_PORT}`)
		.asPortNumber(),
	WEB_HOOK_TOKEN: env.get('WEB_HOOK_TOKEN').default(defaultConfig.WEB_HOOK_TOKEN).asString(),
	DRY_RUN: env.get('DRY_RUN').default(`${defaultConfig.DRY_RUN}`).asBoolStrict(),
	HTTP_PROXY: env.get('HTTP_PROXY').default('').asString(),
});

export type Config = typeof defaultConfig;
