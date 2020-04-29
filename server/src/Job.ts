import deepEqual from 'fast-deep-equal';

export enum JobStatus {
	IN_PROGRESS = 'in_progress',
	REBASING = 'rebasing',
	CHECKING_MERGE_STATUS = 'checking_merge_status',
	WAITING = 'waiting',
	WAITING_FOR_CI = 'waiting_for_ci',
}

interface JobMergeRequest {
	iid: number;
	projectId: number;
	authorId: number;
	title: string;
	webUrl: string;
}

export interface JobInfo {
	mergeRequest: JobMergeRequest;
}

export interface JobArgs {
	success: () => void;
	job: Job;
}

export enum JobPriority {
	HIGH = 'high',
	NORMAL = 'normal',
}

export type JobFunction = (args: JobArgs) => Promise<unknown> | unknown;

export class Job {
	private _info: JobInfo;
	private _status: JobStatus;
	private _priority: JobPriority;

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

	public getData() {
		return {
			priority: this.priority,
			info: this.info,
			status: this.status,
		};
	}
}
