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

export type JobFunction = (args: JobArgs) => Promise<unknown> | unknown;

export class Job {
	private _info: JobInfo;
	private _status: JobStatus;

	private readonly _id: string;
	private readonly _fn: JobFunction;
	private readonly onChange: () => unknown;

	constructor(id: string, fn: JobFunction, info: JobInfo, onChange: () => unknown) {
		this._id = id;
		this._fn = fn;
		this._info = info;
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
}
