export class Queue {

	private promise?: Promise<void>;
	private readonly jobs: { [key: string]: () => any } = {};
	private readonly promises: { [key: string]: Promise<any> } = {};

	public hasJob(jobId: string): boolean {
		return typeof this.promises[jobId] !== 'undefined';
	}

	public runJob<T extends Promise<any>>(jobId: string, job: () => T): T {
		if (typeof this.promises[jobId] !== 'undefined') {
			throw new Error(`JobId ${jobId} is already in queue`);
		}

		const jobPromise = new Promise((resolve) => {
			this.jobs[jobId] = async () => {
				resolve(await job());
			};
		});

		this.promises[jobId] = jobPromise;

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

					delete this.jobs[jobIds[0]];
				}
			});
		}

		return jobPromise as T;
	}

}
