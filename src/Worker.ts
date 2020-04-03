import { JobPriority, Queue } from './Queue';

export class Worker {

	private queues: Queue[] = [];

	public findJobPriorityInQueue(
		queueId: number,
		jobId: string,
	) {
		if (typeof this.queues[queueId] === 'undefined') {
			return null;
		}

		return this.queues[queueId].findPriorityByJobId(jobId);
	}

	public setJobPriority(
		queueId: number,
		jobId: string,
		jobPriority: JobPriority,
	): boolean {
		if (typeof this.queues[queueId] === 'undefined') {
			return false;
		}

		return this.queues[queueId].setJobPriority(jobId, jobPriority);
	}

	public addJobToQueue<T extends Promise<any>>(
		queueId: number,
		jobPriority: JobPriority,
		jobId: string,
		job: () => T,
	): T {
		if (typeof this.queues[queueId] === 'undefined') {
			this.queues[queueId] = new Queue();
		}

		return this.queues[queueId].runJob(jobId, job, jobPriority);
	}

}
