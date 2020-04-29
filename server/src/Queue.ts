import { Config } from './Config';
import { Job, JobFunction, JobInfo, JobPriority, JobStatus } from './Job';

export interface QueueInfo {
	projectName: string;
}

export class Queue {
	private _stop: boolean = true;
	private timer: NodeJS.Timeout | null = null;
	private jobs: Job[] = [];
	private onStop: (() => unknown) | null = null;

	private readonly config: Config;
	private readonly info: QueueInfo;
	private readonly onChange: () => unknown;

	constructor(config: Config, info: QueueInfo, onChange: () => unknown) {
		this.config = config;
		this.info = info;
		this.onChange = onChange;
	}

	public start(): void {
		if (!this._stop) {
			return;
		}

		console.log(`[queue][${this.info.projectName}] Starting`);
		this._stop = false;
		this.loop().catch((error) => console.error(`Error: ${JSON.stringify(error)}`));
	}

	private async loop(): Promise<void> {
		await this.tick()
			.catch((error) => console.error(`Error: ${JSON.stringify(error)}`))
			.then(() => {
				if (this._stop) {
					console.log(`[queue][${this.info.projectName}] Stopped`);
					if (this.onStop) {
						this.onStop();
						this.onStop = null;
					}
					return;
				}

				this.timer = setTimeout(() => {
					this.timer = null;
					this.loop().catch((error) => console.error(`Error: ${JSON.stringify(error)}`));
				}, this.config.CI_CHECK_INTERVAL);
			});
	}

	public async stop(): Promise<void> {
		if (this._stop || this.onStop !== null) {
			return;
		}

		console.log(`[queue][${this.info.projectName}] Shutting down`);
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
			console.log(`[queue][${this.info.projectName}] Stopped`);
			return;
		}

		return new Promise((resolve) => {
			this.onStop = resolve;
			this._stop = true;
		});
	}

	public isEmpty(): boolean {
		return this.jobs.length === 0;
	}

	private findHighPrioritizedJob(): Job | null {
		for (let priority of [JobPriority.HIGH, JobPriority.NORMAL]) {
			const job = this.jobs.find((job) => job.priority === priority);
			if (job !== undefined) {
				return job;
			}
		}

		return null;
	}

	public async tick(): Promise<void> {
		console.log(`[queue][${this.info.projectName}] Tick`);

		while (true) {
			let exitTick = true;

			const job = this.findHighPrioritizedJob();
			if (job === null) {
				return;
			}

			if (this.timer !== null) {
				this.timer.refresh();
			}

			await job.run({
				success: () => {
					this.removeJob(job.id);
					exitTick = false;
				},
				job,
			});

			if (this.timer !== null) {
				this.timer.refresh();
			}

			if (exitTick) {
				return;
			}
		}
	}

	public getData() {
		return {
			info: this.info,
			jobs: this.jobs.map((job) => job.getData()),
		};
	}

	public setJobPriority(jobId: string, jobPriority: JobPriority): void {
		const currentJob = this.findJob(jobId);
		if (currentJob === null) {
			return;
		}

		currentJob.updatePriority(jobPriority);
	}

	public removeJob(jobId: string): void {
		let jobIndex = this.jobs.findIndex((job) => job.id === jobId);
		if (jobIndex === -1) {
			return;
		}

		this.jobs.splice(jobIndex, 1);
		this.onChange();
	}

	public findPriorityByJobId(jobId: string): JobPriority | null {
		const job = this.findJob(jobId);
		if (job !== null) {
			return job.priority;
		}

		return null;
	}

	public findJob(jobId: string): Job | null {
		let job = this.jobs.find((job) => job.id === jobId);
		if (job !== undefined) {
			return job;
		}

		return null;
	}

	public registerJob(
		jobId: string,
		job: JobFunction,
		jobPriority: JobPriority,
		jobInfo: JobInfo,
	): void {
		const currentJob = this.findJob(jobId);
		if (currentJob !== null) {
			currentJob.updateStatus(JobStatus.WAITING);
			currentJob.updateInfo(jobInfo);
			return;
		}

		this.jobs.push(new Job(jobId, job, jobInfo, jobPriority, this.onChange));

		this.onChange();
	}
}
