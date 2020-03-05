export enum QueuePosition {
	START,
	END,
}

export class Queue {

	private promise?: Promise<void>;
	private jobs: { [key: string]: () => any } = {};

	public hasJob(jobId: string): boolean {
		return typeof this.jobs[jobId] !== 'undefined';
	}

	public runJob<T extends Promise<any>>(
		jobId: string,
		job: () => T,
		position: QueuePosition,
	): T {
		if (typeof this.jobs[jobId] !== 'undefined') {
			throw new Error(`JobId ${jobId} is already in queue`);
		}

		const jobPromise = new Promise((resolve, reject) => {
			const fn = async () => {
				try {
					resolve(await job());
				} catch (e) {
					reject(e);
				}
				delete this.jobs[jobId];
			};

			if (position === QueuePosition.END) {
				this.jobs[jobId] = fn;
			} else {
				this.jobs = {[jobId]: fn, ...this.jobs};
			}
		});

		if (this.promise === undefined) {
			this.promise = new Promise(async (resolve, reject) => {
				while (true) {
					const jobIds = Object.keys(this.jobs);
					if (jobIds.length === 0) {
						this.promise = undefined;
						resolve();
						return;
					}

					const currentJob = await this.jobs[jobIds[0]];

					try {
						await currentJob();
					} catch (e) {
						reject(e);
					}
				}
			});
		}

		return jobPromise as T;
	}

}
