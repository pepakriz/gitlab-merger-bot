import express from 'express';
import { v4 as uuid } from 'uuid';
import path from 'path';
import bodyParser from 'body-parser';
import { GitlabApi, MergeState, User } from './GitlabApi';
import { Worker } from './Worker';
import { prepareMergeRequestForMerge } from './MergeRequestReceiver';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { PubSub } from 'graphql-subscriptions';
import http from 'http';
import { AppEvent } from './Types';
import { Resolvers, typeDefs, WebHookHistoryStatus } from './generated/graphqlgen';
import { Config } from './Config';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';

import { assignToAuthorAndResetLabels } from './AssignToAuthor';
import { formatQueueId } from './Utils';
import { WebHookHistory } from './WebHookHistory';

interface MergeRequestAssignee {
	username: string;
}

interface MergeRequestHook {
	object_attributes: {
		id: number;
		iid: number;
		state: MergeState;
		target_project_id: number;
		target_branch: string;
	};
	labels: string[];
	assignees?: MergeRequestAssignee[];
}

enum Events {
	MergeRequest = 'Merge Request Hook',
}

const containsAssignedUser = (mergeRequest: MergeRequestHook, user: User): boolean => {
	console.log('mergeRequest.assignees', mergeRequest.assignees);
	const userNames = mergeRequest.assignees?.map((assignee) => assignee.username);
	return userNames?.includes(user.username) ?? false;
};

type WebHookHistoryMessage = {
	id: string;
	status: WebHookHistoryStatus;
	event?: string;
	data?: string;
	createdAt: number;
};

const processMergeRequestHook = async (
	gitlabApi: GitlabApi,
	worker: Worker,
	user: User,
	data: MergeRequestHook,
	config: Config,
) => {
	if (data.object_attributes.state !== MergeState.Opened) {
		return;
	}

	if (containsAssignedUser(data, user)) {
		const mergeRequest = await gitlabApi.getMergeRequest(
			data.object_attributes.target_project_id,
			data.object_attributes.iid,
		);
		await prepareMergeRequestForMerge(gitlabApi, user, worker, config, { mergeRequest });
		return;
	}

	const jobId = `accept-merge-${data.object_attributes.id}`;
	const currentJob = worker.findJob(formatQueueId(data.object_attributes), jobId);
	if (currentJob !== null) {
		await worker.removeJobFromQueue(formatQueueId(data.object_attributes), jobId);
	}
};

export class WebHookServer {
	private started: boolean = false;
	private httpServer: http.Server | null = null;

	private readonly pubSub: PubSub;
	private readonly gitlabApi: GitlabApi;
	private readonly worker: Worker;
	private readonly user: User;
	private readonly config: Config;
	private readonly webHookHistory: WebHookHistory<WebHookHistoryMessage>;

	constructor(pubSub: PubSub, gitlabApi: GitlabApi, worker: Worker, user: User, config: Config) {
		this.pubSub = pubSub;
		this.gitlabApi = gitlabApi;
		this.worker = worker;
		this.user = user;
		this.config = config;
		this.webHookHistory = new WebHookHistory(config.WEB_HOOK_HISTORY_SIZE);
	}

	public stop(): Promise<void> {
		if (!this.started) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			console.log('[api] Shutting down');
			this.started = false;

			setTimeout(() => {
				if (this.httpServer === null) {
					console.log('[api] Stopped');
					return resolve();
				}

				this.httpServer.close((error) => {
					if (error) {
						return reject(error);
					}

					this.httpServer = null;
					console.log('[api] Stopped');
					return resolve();
				});
			}, 5000);
		});
	}

	public start(): Promise<void> {
		return new Promise((resolve) => {
			const app = express();
			this.httpServer = http.createServer(app);

			app.get('/healthz', (req, res) => {
				if (this.started) {
					res.send('OK');
					return;
				}

				res.status(502);
				res.send('Failed');
			});

			app.use(
				express.static(path.join(process.cwd(), 'dashboard/out'), {
					index: 'index.html',
					extensions: ['html'],
				}),
			);

			app.use(
				bodyParser.json({
					limit: '2mb',
				}),
			);
			app.post('/', async (req, res) => {
				let webHookHistoryMessage: WebHookHistoryMessage = {
					id: uuid(),
					status: WebHookHistoryStatus.UNAUTHORIZED,
					createdAt: Math.floor(Date.now() / 1000),
				};

				try {
					const token = req.headers['x-gitlab-token'];
					if (!token || token !== this.config.WEB_HOOK_TOKEN) {
						res.sendStatus(405);
						res.send(`No X-Gitlab-Token found on request or the token did not match`);
						return;
					}

					const event = req.headers['x-gitlab-event'];
					if (!(typeof event === 'string')) {
						webHookHistoryMessage.status = WebHookHistoryStatus.INVALID_EVENT;

						res.sendStatus(405);
						res.send(`No X-Gitlab-Event found on request`);
						return;
					}

					const data = req.body;

					webHookHistoryMessage = {
						...webHookHistoryMessage,
						status: WebHookHistoryStatus.SKIPPED,
						data: JSON.stringify(data),
						event,
					};

					if (event === Events.MergeRequest) {
						webHookHistoryMessage.status = WebHookHistoryStatus.SUCCESS;
						await processMergeRequestHook(
							this.gitlabApi,
							this.worker,
							this.user,
							data as MergeRequestHook,
							this.config,
						);
					}

					res.send('ok');
				} finally {
					this.webHookHistory.add(webHookHistoryMessage);
					await this.pubSub.publish(AppEvent.WEB_HOOK_HISTORY_CHANGED, {});
				}
			});

			const mapUser = (user: User) => ({
				id: user.id,
				name: user.name,
				username: user.username,
				email: user.email,
				webUrl: user.web_url,
				avatarUrl: user.avatar_url,
			});

			const resolvers: Resolvers = {
				Query: {
					user: async (parent, args) => {
						const user = await this.gitlabApi.getUser(args.input.id);
						console.log('user', user);
						return mapUser(user);
					},
					me: () => mapUser(this.user),
					queues: () => this.worker.getQueuesData(),
				},
				Subscription: {
					queues: {
						resolve: () => this.worker.getQueuesData(),
						subscribe: () => {
							const listenerName = `subscription_${uuid()}`;
							setTimeout(() => {
								this.pubSub
									.publish(listenerName, {})
									.catch((error) =>
										console.log(`Error: ${JSON.stringify(error)}`),
									);
							}, 1);
							return this.pubSub.asyncIterator([
								AppEvent.QUEUE_CHANGED,
								listenerName,
							]) as unknown as AsyncIterable<any>;
						},
					},
					webHookHistory: {
						resolve: () => this.webHookHistory.getHistory(),
						subscribe: () => {
							const listenerName = `subscription_${uuid()}`;
							setTimeout(() => {
								this.pubSub
									.publish(listenerName, {})
									.catch((error) =>
										console.log(`Error: ${JSON.stringify(error)}`),
									);
							}, 1);
							return this.pubSub.asyncIterator([
								AppEvent.WEB_HOOK_HISTORY_CHANGED,
								listenerName,
							]) as unknown as AsyncIterable<any>;
						},
					},
				},
				Mutation: {
					unassign: async (parent, { input }) => {
						const mergeRequest = await this.gitlabApi.getMergeRequest(
							input.projectId,
							input.mergeRequestIid,
						);
						await assignToAuthorAndResetLabels(this.gitlabApi, mergeRequest, this.user);
						const jobId = `accept-merge-${mergeRequest.id}`;
						await this.worker.removeJobFromQueue(formatQueueId(mergeRequest), jobId);

						return null;
					},
				},
			};

			const wsServer = new WebSocketServer({
				server: this.httpServer,
				path: '/graphql',
			});

			const schema = makeExecutableSchema({ typeDefs: typeDefs, resolvers });
			const serverCleanup = useServer({ schema }, wsServer);

			const server = new ApolloServer({
				schema,
				plugins: [
					ApolloServerPluginDrainHttpServer({ httpServer: this.httpServer }),
					{
						async serverWillStart() {
							return {
								async drainServer() {
									await serverCleanup.dispose();
								},
							};
						},
					},
				],
			});

			const httpServer = this.httpServer;

			(async () => {
				await server.start();
				app.use('/graphql', expressMiddleware(server));

				httpServer.listen(this.config.HTTP_SERVER_PORT, () => {
					console.log(
						`[api] API server is listening on port ${this.config.HTTP_SERVER_PORT}`,
					);
					this.started = true;
					return resolve();
				});
			})();
		});
	}
}
