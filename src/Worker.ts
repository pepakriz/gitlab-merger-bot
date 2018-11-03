import { Queue } from './Queue';
import { Job } from './types';

export class Worker {

	private queues: Queue[] = [];

	public addJobToQueue(queueId: number, jobId: string, job: Job): void {
		if (typeof this.queues[queueId] === 'undefined') {
			this.queues[queueId] = new Queue(() => {
				delete this.queues[queueId];
			});
		}

		this.queues[queueId].appendJob(jobId, job);
	}

}
