export enum JobPriority {
	HI,
	NORMAL,
}

interface Jobs {
	[key: string]: () => any;
}

export class Queue {

	private promise?: Promise<void>;
	private jobs: { [key in JobPriority]: Jobs } = {
		[JobPriority.HI]: {},
		[JobPriority.NORMAL]: {},
	};

	public hasJob(
		jobId: string,
		jobPriority: JobPriority,
	): boolean {
		const currentJobPriority = this.getPriorityByJobId(jobId);
		if (currentJobPriority === null) {
			return false;
		}

		if (currentJobPriority === JobPriority.NORMAL && jobPriority === JobPriority.HI) {
			console.log(`[job][${jobId}] Job has been moved to the prioritized queue`);
			this.jobs[jobPriority][jobId] = this.jobs[currentJobPriority][jobId];
			delete this.jobs[currentJobPriority][jobId];
		}

		return true;
	}

	public runJob<T extends Promise<any>>(
		jobId: string,
		job: () => T,
		jobPriority: JobPriority,
	): T {
		const currentJobPriority = this.getPriorityByJobId(jobId);
		if (currentJobPriority !== null) {
			throw new Error(`JobId ${jobId} is already in queue`);
		}

		const jobPromise = new Promise((resolve, reject) => {
			const fn = async () => {
				try {
					resolve(await job());
				} catch (e) {
					reject(e);
				}

				const runtimeJobPriority = this.getPriorityByJobId(jobId);
				if (runtimeJobPriority === null) {
					throw new Error(`JobId ${jobId} not found`);
				}

				delete this.jobs[runtimeJobPriority][jobId];
			};

			this.jobs[jobPriority][jobId] = fn;
		});

		if (this.promise === undefined) {
			this.promise = new Promise(async (resolve, reject) => {
				while (true) {
					let jobIds = Object.keys(this.jobs[JobPriority.HI]);
					let priority = JobPriority.HI;

					if (jobIds.length === 0) {
						jobIds = Object.keys(this.jobs[JobPriority.NORMAL]);
						if (jobIds.length === 0) {
							this.promise = undefined;
							resolve();
							return;
						}

						priority = JobPriority.NORMAL;
					}

					const currentJob = await this.jobs[priority][jobIds[0]];

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

	private getPriorityByJobId(jobId: string): JobPriority | null {
		if (typeof this.jobs[JobPriority.HI][jobId] !== 'undefined') {
			return JobPriority.HI;
		}

		if (typeof this.jobs[JobPriority.NORMAL][jobId] !== 'undefined') {
			return JobPriority.NORMAL;
		}

		return null;
	}

}
