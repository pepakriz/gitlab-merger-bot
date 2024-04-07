import { GitlabApi, MergeRequest, ToDo, User } from './GitlabApi';
import { prepareMergeRequestForMerge } from './MergeRequestReceiver';
import { Config } from './Config';
import { Worker } from './Worker';

export class MergeRequestCheckerLoop {
	private _stop: boolean = true;
	private timer: NodeJS.Timeout | null = null;
	private onStop: (() => unknown) | null = null;

	private readonly gitlabApi: GitlabApi;
	private readonly config: Config;
	private readonly user: User;
	private readonly worker: Worker;

	constructor(gitlabApi: GitlabApi, config: Config, user: User, worker: Worker) {
		this.gitlabApi = gitlabApi;
		this.config = config;
		this.user = user;
		this.worker = worker;
	}

	public start(): void {
		if (!this._stop) {
			return;
		}

		console.log('[loop] Starting');
		this._stop = false;
		this.loop().catch((error) => console.error(`Error: ${JSON.stringify(error)}`));
	}

	private async loop(): Promise<void> {
		await this.task()
			.catch((error) => console.error(`Error: ${JSON.stringify(error)}`))
			.then(() => {
				if (this._stop) {
					console.log('[loop] Stopped');
					if (this.onStop) {
						this.onStop();
						this.onStop = null;
					}
					return;
				}

				this.timer = setTimeout(() => {
					this.timer = null;
					this.loop().catch((error) => console.error(`Error: ${JSON.stringify(error)}`));
				}, this.config.MR_CHECK_INTERVAL);
			});
	}

	public async stop(): Promise<void> {
		if (this._stop || this.onStop !== null) {
			return;
		}

		console.log('[loop] Shutting down');
		if (this.timer !== null) {
			clearTimeout(this.timer);
			console.log('[loop] Stopped');
			return;
		}

		return new Promise((resolve) => {
			this.onStop = resolve;
			this._stop = true;
		});
	}

	private async task() {
		if (this.config.ENABLE_PERMISSION_VALIDATION) {
			console.log('[loop] Checking new todos');
			const mergeRequestTodos = await this.gitlabApi.getMergeRequestTodos();
			const possibleToAcceptMergeRequests = mergeRequestTodos.map((mergeRequestTodo: ToDo) =>
				prepareMergeRequestForMerge(this.gitlabApi, this.user, this.worker, this.config, {
					mergeRequestTodo,
				}),
			);

			await Promise.all(possibleToAcceptMergeRequests);
			return;
		}

		console.log('[loop] Checking assigned merge requests');
		const assignedMergeRequests = await this.gitlabApi.getAssignedOpenedMergeRequests();
		const possibleToAcceptMergeRequests = assignedMergeRequests.map(
			(mergeRequest: MergeRequest) =>
				prepareMergeRequestForMerge(this.gitlabApi, this.user, this.worker, this.config, {
					mergeRequest,
				}),
		);

		await Promise.all(possibleToAcceptMergeRequests);
	}
}
