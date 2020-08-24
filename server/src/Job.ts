import deepEqual from 'fast-deep-equal';
import { JobInfo, JobPriority, JobStatus, Job as GQLJob } from './generated/graphqlgen';

export interface JobArgs {
	success: () => void;
	job: Job;
}

export type JobFunction = (args: JobArgs) => Promise<unknown> | unknown;

interface JobState {
	checkManualJobs: boolean;
}

export class Job {
	private _info: JobInfo;
	private _status: JobStatus;
	private _priority: JobPriority;
	private _state: JobState = {
		checkManualJobs: true,
	};

	private readonly _id: string;
	private readonly _fn: JobFunction;
	private readonly onChange: () => unknown;

	constructor(
		id: string,
		fn: JobFunction,
		info: JobInfo,
		priority: JobPriority,
		onChange: () => unknown,
	) {
		this._id = id;
		this._fn = fn;
		this._info = info;
		this._priority = priority;
		this.onChange = onChange;

		this._status = JobStatus.WAITING;
	}

	public updateStatus(status: JobStatus): void {
		if (this._status === status) {
			return;
		}

		this._status = status;
		this.onChange();
	}

	public updateInfo(info: JobInfo): void {
		if (deepEqual(this._info, info)) {
			return;
		}

		this._info = info;
		this.onChange();
	}

	public updatePriority(priority: JobPriority): void {
		if (deepEqual(this._priority, priority)) {
			return;
		}

		this._priority = priority;
		this.onChange();
	}

	public updateState(callback: (state: JobState) => JobState) {
		this._state = callback(this._state);
	}

	public run(args: JobArgs): Promise<unknown> | unknown {
		return this._fn(args);
	}

	get id(): string {
		return this._id;
	}

	get status(): JobStatus {
		return this._status;
	}

	get info(): JobInfo {
		return this._info;
	}

	get priority(): JobPriority {
		return this._priority;
	}

	get state(): JobState {
		return this._state;
	}

	public getData(): GQLJob {
		return {
			priority: this.priority,
			info: this.info,
			status: this.status,
		};
	}
}
