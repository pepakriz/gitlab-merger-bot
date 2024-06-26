import * as Sentry from '@sentry/node';
import * as env from 'env-var';
import { GitlabApi } from './GitlabApi';
import { Worker } from './Worker';
import { getConfig } from './Config';
import { PubSub } from 'graphql-subscriptions';
import { MergeRequestCheckerLoop } from './MergeRequestCheckerLoop';
import { WebHookServer } from './WebHookServer';

const SENTRY_DSN = env.get('SENTRY_DSN').default('').asString();
if (SENTRY_DSN !== '') {
	Sentry.init({ dsn: SENTRY_DSN });
}

const config = getConfig();
const gitlabApi = new GitlabApi(
	config.GITLAB_URL,
	config.GITLAB_AUTH_TOKEN,
	config.HTTP_PROXY !== '' ? config.HTTP_PROXY : undefined,
);
const pubSub = new PubSub();
const worker = new Worker(pubSub, config);

(async () => {
	console.log(`Configuration:`);
	console.log(
		JSON.stringify(
			{
				...config,
				GITLAB_AUTH_TOKEN: '*******',
			},
			null,
			4,
		),
	);

	const user = await gitlabApi.getMe();

	console.log(`[bot] Hi, I'm ${user.name}. I'll accept merge request assigned to me.`);

	const shutdownHandlers: (() => Promise<any>)[] = [];
	const webHookServer = new WebHookServer(pubSub, gitlabApi, worker, user, config);

	if (config.MR_CHECK_INTERVAL > 0) {
		const mergeRequestCheckerLoop = new MergeRequestCheckerLoop(
			gitlabApi,
			config,
			user,
			worker,
		);
		mergeRequestCheckerLoop.start();
		shutdownHandlers.push(() => mergeRequestCheckerLoop.stop());
	} else {
		console.log(
			`[bot] The merge request checker loop is disabled, because MR_CHECK_INTERVAL is set to zero.`,
		);
	}

	worker.start();
	shutdownHandlers.push(() => worker.stop());

	if (config.HTTP_SERVER_ENABLE) {
		await webHookServer.start();
	}

	const shutdownHandler = async (signal: NodeJS.Signals) => {
		console.log(`[bot] Caught ${signal} signal`);

		const promises: Promise<any>[] = shutdownHandlers.map((shutdownHandler) =>
			shutdownHandler(),
		);

		if (config.HTTP_SERVER_ENABLE) {
			promises.push(webHookServer.stop());
		}

		Promise.all(promises).finally(() => {
			process.exit(0);
		});
	};

	process.on('exit', () => {
		console.log(`[bot] App stopped!`);
	});
	process.on('SIGINT', shutdownHandler);
	process.on('SIGTERM', shutdownHandler);
})();
