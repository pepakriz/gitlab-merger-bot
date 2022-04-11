import { Queue } from './Queue';
import { PubSub } from 'apollo-server';
import { AppEvent } from './Types';
import { Config } from './Config';
import { Job, JobFunction } from './Job';
import { JobInfo, JobPriority, QueueInfo, Queue as GQLQueue } from './generated/graphqlgen';

export class Worker {
	private _stop: boolean = true;
	private queues: Record<number, Queue> = {};

	private readonly pubSub: PubSub;
	private readonly config: Config;

	constructor(pubSub: PubSub, config: Config) {
		this.pubSub = pubSub;
		this.config = config;
	}

	public getQueuesData(): GQLQueue[] {
		return Object.entries(this.queues).map(([key, value]) => ({
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

		return Object.entries(this.queues).forEach(([key, value]) => {
			value.start();
		});
	}

	public async stop(): Promise<void> {
		if (this._stop) {
			return;
		}

		console.log('[worker] Shutting down');
		this._stop = true;
		await Promise.all(Object.entries(this.queues).map(([key, value]) => value.stop()));
		console.log('[worker] Stopped');
	}

	public findJobPriorityInQueue(queueId: number, jobId: string): JobPriority | null {
		if (typeof this.queues[queueId] === 'undefined') {
			return null;
		}

		return this.queues[queueId].findPriorityByJobId(jobId);
	}

	public findJob(queueId: number, jobId: string): Job | null {
		if (typeof this.queues[queueId] === 'undefined') {
			return null;
		}

		return this.queues[queueId].findJob(jobId);
	}

	public setJobPriority(queueId: number, jobId: string, jobPriority: JobPriority): void {
		if (typeof this.queues[queueId] === 'undefined') {
			return;
		}

		this.queues[queueId].setJobPriority(jobId, jobPriority);
	}

	public async removeJobFromQueue(queueId: number, jobId: string) {
		this.queues[queueId].removeJob(jobId);
	}

	public registerJobToQueue<T extends Promise<any>>(
		queueId: number,
		queueInfo: QueueInfo,
		jobPriority: JobPriority,
		jobId: string,
		job: JobFunction,
		jobInfo: JobInfo,
	): void {
		if (typeof this.queues[queueId] === 'undefined') {
			console.log(`[worker][${queueId}] Creating queue`);
			this.queues[queueId] = new Queue(this.config, queueInfo, async () => {
				Object.entries(this.queues).map(([key, value]) => {
					if (value.isEmpty()) {
						console.log(`[worker][${queueId}] Deleting queue`);
						const queue = this.queues[parseInt(key, 10)];
						queue.stop();
						delete this.queues[parseInt(key, 10)];
					}
				});

				await this.pubSub.publish(AppEvent.QUEUE_CHANGED, {});
			});

			if (!this._stop) {
				this.queues[queueId].start();
			}
		}

		this.queues[queueId].registerJob(jobId, job, jobPriority, jobInfo);
	}
}
