import { Config } from './Config';
import { Job, JobFunction, JobInfo, JobStatus } from './Job';

export enum JobPriority {
	HIGH = 'high',
	NORMAL = 'normal',
}

interface Jobs {
	[key: string]: Job;
}

export interface QueueInfo {
	projectName: string;
}

export class Queue {
	private _stop: boolean = true;
	private timer: NodeJS.Timeout | null = null;
	private jobs: { [key in JobPriority]: Jobs } = {
		[JobPriority.HIGH]: {},
		[JobPriority.NORMAL]: {},
	};
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
		return (
			Object.keys(this.jobs[JobPriority.NORMAL]).length === 0 &&
			Object.keys(this.jobs[JobPriority.HIGH]).length === 0
		);
	}

	public findHighPrioritizedJob(): Job | null {
		let jobIds = Object.keys(this.jobs[JobPriority.HIGH]);
		if (jobIds.length > 0) {
			return this.jobs[JobPriority.HIGH][jobIds[0]];
		}

		jobIds = Object.keys(this.jobs[JobPriority.NORMAL]);
		if (jobIds.length > 0) {
			return this.jobs[JobPriority.NORMAL][jobIds[0]];
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
			[JobPriority.HIGH]: Object.keys(this.jobs[JobPriority.HIGH]).map((key) => ({
				status: this.jobs[JobPriority.HIGH][key].status,
				info: this.jobs[JobPriority.HIGH][key].info,
			})),
			[JobPriority.NORMAL]: Object.keys(this.jobs[JobPriority.NORMAL]).map((key) => ({
				status: this.jobs[JobPriority.NORMAL][key].status,
				info: this.jobs[JobPriority.NORMAL][key].info,
			})),
		};
	}

	public setJobPriority(jobId: string, jobPriority: JobPriority): boolean {
		const currentJobPriority = this.findPriorityByJobId(jobId);
		if (currentJobPriority === null) {
			return false;
		}

		if (currentJobPriority === JobPriority.NORMAL && jobPriority === JobPriority.HIGH) {
			this.jobs[jobPriority][jobId] = this.jobs[currentJobPriority][jobId];
			delete this.jobs[currentJobPriority][jobId];
			this.onChange();
		}

		return true;
	}

	public removeJob(jobId: string) {
		const currentJobPriority = this.findPriorityByJobId(jobId);
		if (currentJobPriority === null) {
			return;
		}

		delete this.jobs[currentJobPriority][jobId];
		this.onChange();
	}

	public findPriorityByJobId(jobId: string): JobPriority | null {
		if (typeof this.jobs[JobPriority.HIGH][jobId] !== 'undefined') {
			return JobPriority.HIGH;
		}

		if (typeof this.jobs[JobPriority.NORMAL][jobId] !== 'undefined') {
			return JobPriority.NORMAL;
		}

		return null;
	}

	public findJob(jobId: string): Job | null {
		if (typeof this.jobs[JobPriority.HIGH][jobId] !== 'undefined') {
			return this.jobs[JobPriority.HIGH][jobId];
		}

		if (typeof this.jobs[JobPriority.NORMAL][jobId] !== 'undefined') {
			return this.jobs[JobPriority.NORMAL][jobId];
		}

		return null;
	}

	public registerJob(
		jobId: string,
		job: JobFunction,
		jobPriority: JobPriority,
		jobInfo: JobInfo,
	): void {
		const currentJobPriority = this.findPriorityByJobId(jobId);
		if (currentJobPriority !== null) {
			return;
		}

		this.jobs[jobPriority][jobId] = new Job(jobId, job, jobInfo, this.onChange);

		this.onChange();
	}
}
