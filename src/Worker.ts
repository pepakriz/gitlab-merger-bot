import { Queue, QueuePosition } from './Queue';

export class Worker {

	private queues: Queue[] = [];

	public hasJobInQueue(queueId: number, jobId: string): boolean {
		if (typeof this.queues[queueId] === 'undefined') {
			return false;
		}

		return this.queues[queueId].hasJob(jobId);
	}

	public addJobToQueue<T extends Promise<any>>(
		queueId: number,
		queuePosition: QueuePosition,
		jobId: string,
		job: () => T,
	): T {
		if (typeof this.queues[queueId] === 'undefined') {
			this.queues[queueId] = new Queue();
		}

		return this.queues[queueId].runJob(jobId, job, queuePosition);
	}

}
