import { Queue } from './Queue';
import { Job } from './types';

export class Worker {

	private queues: Queue[] = [];

	public addJobToQueue(queueId: number, jobId: string, job: Job): Promise<void> {
		if (typeof this.queues[queueId] === 'undefined') {
			this.queues[queueId] = new Queue();
		}

		return this.queues[queueId].runJob(jobId, job);
	}

}
