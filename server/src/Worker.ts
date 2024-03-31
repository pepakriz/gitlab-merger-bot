import { Queue } from './Queue';
import { PubSub } from 'graphql-subscriptions';
import { AppEvent } from './Types';
import { Config } from './Config';
import { Job, JobFunction } from './Job';
import { JobInfo, JobPriority, QueueInfo, Queue as GQLQueue } from './generated/graphqlgen';

export type QueueId = string & { _kind: 'QueueId' };

export class Worker {
	private _stop: boolean = true;
	private queues = new Map<QueueId, Queue>();

	private readonly pubSub: PubSub;
	private readonly config: Config;

	constructor(pubSub: PubSub, config: Config) {
		this.pubSub = pubSub;
		this.config = config;
	}

	public getQueuesData(): GQLQueue[] {
		return Array.from(this.queues.entries()).map(([key, value]) => ({
			name: key,
			...value.getData(),
		}));
	}

	public start(): void {
		if (!this._stop) {
			return;
		}

		console.log('[worker] Starting');
		this._stop = false;

		return Array.from(this.queues.values()).forEach((queue) => {
			queue.start();
		});
	}

	public async stop(): Promise<void> {
		if (this._stop) {
			return;
		}

		console.log('[worker] Shutting down');
		this._stop = true;
		await Promise.all(Array.from(this.queues.values()).map((queue) => queue.stop()));
		console.log('[worker] Stopped');
	}

	public findJobPriorityInQueue(queueId: QueueId, jobId: string): JobPriority | null {
		const queue = this.queues.get(queueId);
		if (queue === undefined) {
			return null;
		}

		return queue.findPriorityByJobId(jobId);
	}

	public findJob(queueId: QueueId, jobId: string): Job | null {
		const queue = this.queues.get(queueId);
		if (queue === undefined) {
			return null;
		}

		return queue.findJob(jobId);
	}

	public setJobPriority(queueId: QueueId, jobId: string, jobPriority: JobPriority): void {
		const queue = this.queues.get(queueId);
		if (queue === undefined) {
			return;
		}

		queue.setJobPriority(jobId, jobPriority);
	}

	public async removeJobFromQueue(queueId: QueueId, jobId: string) {
		const queue = this.queues.get(queueId);
		if (queue === undefined) {
			return;
		}

		queue.removeJob(jobId);
	}

	public registerJobToQueue<T extends Promise<any>>(
		queueId: QueueId,
		queueInfo: QueueInfo,
		jobPriority: JobPriority,
		jobId: string,
		job: JobFunction,
		jobInfo: JobInfo,
	): void {
		let queue = this.queues.get(queueId);
		if (queue === undefined) {
			console.log(`[worker][${queueId}] Creating queue`);
			queue = new Queue(this.config, queueInfo, async () => {
				Array.from(this.queues.entries()).map(([key, value]) => {
					if (value.isEmpty()) {
						console.log(`[worker][${queueId}] Deleting queue`);
						value.stop();
						this.queues.delete(key);
					}
				});

				await this.pubSub.publish(AppEvent.QUEUE_CHANGED, {});
			});

			this.queues.set(queueId, queue);

			if (!this._stop) {
				queue.start();
			}
		}

		queue.registerJob(jobId, job, jobPriority, jobInfo);
	}
}
