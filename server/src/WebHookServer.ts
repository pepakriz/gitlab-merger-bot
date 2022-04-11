import express from 'express';
import { v4 as uuid } from 'uuid';
import path from 'path';
import serveStatic from 'serve-static';
import bodyParser from 'body-parser';
import { GitlabApi, MergeState, User } from './GitlabApi';
import { Worker } from './Worker';
import { prepareMergeRequestForMerge } from './MergeRequestReceiver';
import { ApolloServer, gql } from 'apollo-server-express';
import { PubSub } from 'apollo-server';
import http from 'http';
import { AppEvent } from './Types';
import { Resolvers } from './generated/graphqlgen';
import { Config } from './Config';

// @ts-ignore
import typeDefs from '../../schema.graphql';
import { assignToAuthorAndResetLabels } from './AssignToAuthor';

interface MergeRequestAssignee {
	username: string;
}

interface MergeRequestHook {
	project: {
		id: number;
	};
	object_attributes: {
		id: number;
		iid: number;
		state: MergeState;
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
			data.project.id,
			data.object_attributes.iid,
		);
		await prepareMergeRequestForMerge(gitlabApi, user, worker, config, mergeRequest);
		return;
	}

	const jobId = `accept-merge-${data.object_attributes.id}`;
	const currentJob = worker.findJob(data.project.id, jobId);
	if (currentJob !== null) {
		await worker.removeJobFromQueue(data.project.id, jobId);
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

	constructor(pubSub: PubSub, gitlabApi: GitlabApi, worker: Worker, user: User, config: Config) {
		this.pubSub = pubSub;
		this.gitlabApi = gitlabApi;
		this.worker = worker;
		this.user = user;
		this.config = config;
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

				res.sendStatus(502);
				res.send('Failed');
			});

			app.use(
				serveStatic(path.join(process.cwd(), 'dashboard/out'), {
					index: 'index.html',
				}),
			);
			app.use(bodyParser.json());
			app.post('/', async (req, res) => {
				const token = req.headers['x-gitlab-token'];
				if (!token || token !== this.config.WEB_HOOK_TOKEN) {
					res.sendStatus(405);
					res.send(`No X-Gitlab-Token found on request or the token did not match`);
					return;
				}

				const event = req.headers['x-gitlab-event'];
				if (!event) {
					res.sendStatus(405);
					res.send(`No X-Gitlab-Event found on request`);
					return;
				}

				const data = req.body;
				if (event === Events.MergeRequest) {
					await processMergeRequestHook(
						this.gitlabApi,
						this.worker,
						this.user,
						data as MergeRequestHook,
						this.config,
					);
				}

				res.send('ok');
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
							]);
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
						await this.worker.removeJobFromQueue(mergeRequest.project_id, jobId);

						return null;
					},
				},
			};

			const server = new ApolloServer({
				typeDefs,
				resolvers,
				subscriptions: {
					path: '/graphql',
				},
			});
			server.applyMiddleware({ app, path: '/graphql' });
			server.installSubscriptionHandlers(this.httpServer);

			this.httpServer.listen(this.config.HTTP_SERVER_PORT, () => {
				console.log(
					`[api] API server is listening on port ${this.config.HTTP_SERVER_PORT}`,
				);
				this.started = true;
				return resolve();
			});
		});
	}
}
