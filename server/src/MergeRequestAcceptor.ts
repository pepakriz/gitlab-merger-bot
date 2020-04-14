import {
	GitlabApi,
	MergeRequest,
	MergeRequestApprovals,
	MergeRequestInfo,
	MergeRequestPipeline,
	MergeState,
	MergeStatus,
	PipelineJob,
	PipelineJobStatus,
	PipelineStatus,
	RequestMethod,
	User,
} from './GitlabApi';
import { tryCancelPipeline } from './PipelineCanceller';
import { setBotLabels } from './BotLabelsSetter';
import { Config } from './Config';
import { Job, JobStatus } from './Job';

export enum AcceptMergeRequestResultKind {
	SuccessfullyMerged,
	ClosedMergeRequest,
	ReassignedMergeRequest,
	CanNotBeMerged,
	HasConflict,
	FailedPipeline,
	PipelineInProgress,
	InvalidPipeline,
	WaitingPipeline,
	WaitingForApprovals,
	UnresolvedDiscussion,
	Unauthorized,
	InvalidSha,
	RebaseInProgress,
	CheckingMergeStatus,
	WorkInProgress,
}

interface Response {
	mergeRequestInfo: MergeRequestInfo;
	user: User;
}

interface SuccessResponse extends Response {
	kind: AcceptMergeRequestResultKind.SuccessfullyMerged;
	mergeRequestInfo: MergeRequestInfo;
}

interface ClosedMergeRequestResponse extends Response {
	kind: AcceptMergeRequestResultKind.ClosedMergeRequest;
	mergeRequestInfo: MergeRequestInfo;
}

interface ReassignedMergeRequestResponse extends Response {
	kind: AcceptMergeRequestResultKind.ReassignedMergeRequest;
	mergeRequestInfo: MergeRequestInfo;
}

interface CanNotBeMergedResponse extends Response {
	kind: AcceptMergeRequestResultKind.CanNotBeMerged;
	mergeRequestInfo: MergeRequestInfo;
}

interface HasConflictResponse extends Response {
	kind: AcceptMergeRequestResultKind.HasConflict;
	mergeRequestInfo: MergeRequestInfo;
}

interface FailedPipelineResponse extends Response {
	kind: AcceptMergeRequestResultKind.FailedPipeline;
	mergeRequestInfo: MergeRequestInfo;
	pipeline: MergeRequestPipeline;
}

interface InvalidPipelineResponse extends Response {
	kind: AcceptMergeRequestResultKind.InvalidPipeline;
	mergeRequestInfo: MergeRequestInfo;
	pipeline: MergeRequestPipeline | null;
}

interface WaitingPipelineResponse extends Response {
	kind: AcceptMergeRequestResultKind.WaitingPipeline;
	mergeRequestInfo: MergeRequestInfo;
	pipeline: MergeRequestPipeline;
}

interface WaitingForApprovalsResponse extends Response {
	kind: AcceptMergeRequestResultKind.WaitingForApprovals;
	mergeRequestInfo: MergeRequestInfo;
	approvals: MergeRequestApprovals;
}

interface UnresolvedDiscussionResponse extends Response {
	kind: AcceptMergeRequestResultKind.UnresolvedDiscussion;
	mergeRequestInfo: MergeRequestInfo;
}

interface UnauthorizedResponse extends Response {
	kind: AcceptMergeRequestResultKind.Unauthorized;
	mergeRequestInfo: MergeRequestInfo;
}

interface InvalidShaResponse extends Response {
	kind: AcceptMergeRequestResultKind.InvalidSha;
	mergeRequestInfo: MergeRequestInfo;
}

interface RebaseInProgressResponse extends Response {
	kind: AcceptMergeRequestResultKind.RebaseInProgress;
	mergeRequestInfo: MergeRequestInfo;
}

interface CheckingMergeStatusResponse extends Response {
	kind: AcceptMergeRequestResultKind.CheckingMergeStatus;
	mergeRequestInfo: MergeRequestInfo;
}

interface WorkInProgressResponse extends Response {
	kind: AcceptMergeRequestResultKind.WorkInProgress;
	mergeRequestInfo: MergeRequestInfo;
}

interface PipelineInProgressResponse extends Response {
	kind: AcceptMergeRequestResultKind.PipelineInProgress;
	mergeRequestInfo: MergeRequestInfo;
	pipeline: MergeRequestPipeline;
}

export type AcceptMergeRequestResult =
	| SuccessResponse
	| ClosedMergeRequestResponse
	| ReassignedMergeRequestResponse
	| CanNotBeMergedResponse
	| HasConflictResponse
	| FailedPipelineResponse
	| InvalidPipelineResponse
	| WaitingPipelineResponse
	| WaitingForApprovalsResponse
	| UnresolvedDiscussionResponse
	| WorkInProgressResponse
	| UnauthorizedResponse;

export type MergeMergeRequestResult =
	| SuccessResponse
	| ClosedMergeRequestResponse
	| ReassignedMergeRequestResponse
	| CanNotBeMergedResponse
	| HasConflictResponse
	| InvalidShaResponse
	| UnresolvedDiscussionResponse
	| RebaseInProgressResponse
	| CheckingMergeStatusResponse
	| WorkInProgressResponse
	| PipelineInProgressResponse
	| UnauthorizedResponse;

export interface AcceptMergeRequestOptions {
	removeBranchAfterMerge: boolean;
	squashMergeRequest: boolean;
	skipSquashingLabel: string;
}

export interface RunAcceptingMergeRequestOptions extends AcceptMergeRequestOptions {
	ciInterval: number;
	autorunManualBlockingJobs: boolean;
}

export enum BotLabels {
	InMergeQueue = 'in-merge-queue',
	Accepting = 'accepting',
	WaitingForPipeline = 'waiting-for-pipeline',
}

const startingOrInProgressPipelineStatuses = [
	PipelineStatus.Running,
	PipelineStatus.Pending,
	PipelineStatus.WaitingForResource,
	PipelineStatus.Preparing,
];

const containsLabel = (labels: string[], label: BotLabels) => labels.includes(label);
const containsAssignedUser = (mergeRequest: MergeRequest, user: User) => {
	const userIds = mergeRequest.assignees.map((assignee) => assignee.id);
	return userIds.includes(user.id);
};
const defaultPipelineValidationRetries = 5;
const defaultRebasingRetries = 1;

export const filterBotLabels = (labels: string[]): string[] => {
	const values = Object.values(BotLabels) as string[];

	return labels.filter((label) => !values.includes(label));
};

const uniqueNamedJobsByDate = (jobs: PipelineJob[]): PipelineJob[] => {
	const jobRecord: Record<string, PipelineJob> = {};
	jobs.forEach((job) => {
		if (jobRecord[job.name] !== undefined) {
			const currentJob = jobRecord[job.name];
			const currentJobCreatedAt = new Date(currentJob.created_at);

			if (currentJobCreatedAt > new Date(job.created_at)) {
				return;
			}
		}

		jobRecord[job.name] = job;
	});

	return Object.values(jobRecord);
};

export const acceptMergeRequest = async (
	gitlabApi: GitlabApi,
	projectId: number,
	mergeRequestIid: number,
	user: User,
	config: Config,
): Promise<MergeMergeRequestResult> => {
	console.log(`[MR][${mergeRequestIid}] Calling merge request`);
	const mergeRequestInfo = await gitlabApi.getMergeRequestInfo(projectId, mergeRequestIid);

	if (mergeRequestInfo.state === MergeState.Merged) {
		return {
			kind: AcceptMergeRequestResultKind.SuccessfullyMerged,
			mergeRequestInfo,
			user,
		};
	}

	if (mergeRequestInfo.state === MergeState.Closed) {
		return {
			kind: AcceptMergeRequestResultKind.ClosedMergeRequest,
			mergeRequestInfo,
			user,
		};
	}

	if (mergeRequestInfo.state !== MergeState.Opened) {
		throw new Error(`Unexpected MR status: ${mergeRequestInfo.state}`);
	}

	if (!mergeRequestInfo.blocking_discussions_resolved) {
		return {
			kind: AcceptMergeRequestResultKind.UnresolvedDiscussion,
			mergeRequestInfo,
			user,
		};
	}

	if (!containsAssignedUser(mergeRequestInfo, user)) {
		return {
			kind: AcceptMergeRequestResultKind.ReassignedMergeRequest,
			mergeRequestInfo,
			user,
		};
	}

	if (mergeRequestInfo.rebase_in_progress) {
		return {
			kind: AcceptMergeRequestResultKind.RebaseInProgress,
			mergeRequestInfo,
			user,
		};
	}

	if (mergeRequestInfo.merge_status === MergeStatus.Checking) {
		return {
			kind: AcceptMergeRequestResultKind.CheckingMergeStatus,
			mergeRequestInfo,
			user,
		};
	}

	if (mergeRequestInfo.has_conflicts) {
		return {
			kind: AcceptMergeRequestResultKind.HasConflict,
			mergeRequestInfo,
			user,
		};
	}

	if (mergeRequestInfo.work_in_progress) {
		return {
			kind: AcceptMergeRequestResultKind.WorkInProgress,
			mergeRequestInfo,
			user,
		};
	}

	if (
		mergeRequestInfo.head_pipeline !== null &&
		startingOrInProgressPipelineStatuses.includes(mergeRequestInfo.head_pipeline.status)
	) {
		return {
			kind: AcceptMergeRequestResultKind.PipelineInProgress,
			mergeRequestInfo,
			user,
			pipeline: mergeRequestInfo.head_pipeline,
		};
	}

	if (
		mergeRequestInfo.pipeline !== null &&
		startingOrInProgressPipelineStatuses.includes(mergeRequestInfo.pipeline.status)
	) {
		return {
			kind: AcceptMergeRequestResultKind.PipelineInProgress,
			mergeRequestInfo,
			user,
			pipeline: mergeRequestInfo.pipeline,
		};
	}

	const useSquash = mergeRequestInfo.labels.includes(config.SKIP_SQUASHING_LABEL)
		? false
		: config.SQUASH_MERGE_REQUEST;
	if (mergeRequestInfo.squash && !useSquash) {
		// Because usage `squash=false` during accept MR has no effect and it just uses squash setting from the MR
		await gitlabApi.updateMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid, {
			squash: false,
		});
	}

	if (config.DRY_RUN) {
		return {
			kind: AcceptMergeRequestResultKind.CheckingMergeStatus,
			mergeRequestInfo,
			user,
		};
	}

	const response = await gitlabApi.sendRawRequest(
		`/api/v4/projects/${mergeRequestInfo.project_id}/merge_requests/${mergeRequestInfo.iid}/merge`,
		RequestMethod.Put,
		{
			should_remove_source_branch: config.REMOVE_BRANCH_AFTER_MERGE,
			sha: mergeRequestInfo.diff_refs.head_sha,
			squash: useSquash,
			squash_commit_message: `${mergeRequestInfo.title} (!${mergeRequestInfo.iid})`,
			merge_commit_message: `${mergeRequestInfo.title} (!${mergeRequestInfo.iid})`,
		},
	);

	if (response.status === 405 || response.status === 406) {
		console.log(`[MR][${mergeRequestInfo.iid}] ${response.status} - cannot be merged`);
		return {
			kind: AcceptMergeRequestResultKind.CanNotBeMerged,
			mergeRequestInfo,
			user,
		};
	}

	if (response.status === 409) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] ${response.status} - SHA does not match HEAD of source branch`,
		);
		return {
			kind: AcceptMergeRequestResultKind.InvalidSha,
			mergeRequestInfo,
			user,
		};
	}

	if (response.status === 401) {
		console.log(`[MR][${mergeRequestInfo.iid}] ${response.status} - Unauthorized`);
		return {
			kind: AcceptMergeRequestResultKind.Unauthorized,
			mergeRequestInfo,
			user,
		};
	}

	if (response.status !== 200) {
		throw new Error(`Unsupported response status ${response.status}`);
	}

	const data = await response.json();
	if (typeof data !== 'object' && data.id === undefined) {
		console.error('response', data);
		throw new Error('Invalid response');
	}

	return {
		kind: AcceptMergeRequestResultKind.SuccessfullyMerged,
		mergeRequestInfo,
		user,
	};
};

export const runAcceptingMergeRequest = async (
	job: Job,
	gitlabApi: GitlabApi,
	projectId: number,
	mergeRequestIid: number,
	user: User,
	config: Config,
): Promise<AcceptMergeRequestResult | void> => {
	console.log(`[MR][${mergeRequestIid}] Checking...`);

	let numberOfPipelineValidationRetries = defaultPipelineValidationRetries;
	let numberOfRebasingRetries = defaultRebasingRetries;

	const mergeResponse = await acceptMergeRequest(
		gitlabApi,
		projectId,
		mergeRequestIid,
		user,
		config,
	);
	if (
		mergeResponse.kind === AcceptMergeRequestResultKind.SuccessfullyMerged ||
		mergeResponse.kind === AcceptMergeRequestResultKind.ClosedMergeRequest ||
		mergeResponse.kind === AcceptMergeRequestResultKind.Unauthorized ||
		mergeResponse.kind === AcceptMergeRequestResultKind.WorkInProgress ||
		mergeResponse.kind === AcceptMergeRequestResultKind.UnresolvedDiscussion ||
		mergeResponse.kind === AcceptMergeRequestResultKind.ReassignedMergeRequest ||
		mergeResponse.kind === AcceptMergeRequestResultKind.HasConflict
	) {
		return mergeResponse;
	}

	const mergeRequestInfo = mergeResponse.mergeRequestInfo;

	if (!containsLabel(mergeRequestInfo.labels, BotLabels.Accepting)) {
		await setBotLabels(gitlabApi, mergeRequestInfo, [BotLabels.Accepting]);
	}

	const approvals = await gitlabApi.getMergeRequestApprovals(
		mergeRequestInfo.project_id,
		mergeRequestInfo.iid,
	);
	if (approvals.approvals_left > 0) {
		return {
			kind: AcceptMergeRequestResultKind.WaitingForApprovals,
			mergeRequestInfo,
			user,
			approvals,
		};
	}

	if (mergeRequestInfo.diverged_commits_count > 0) {
		if (numberOfRebasingRetries <= 0 && mergeRequestInfo.merge_error !== null) {
			console.log(`[MR][${mergeRequestInfo.iid}] Merge error after rebase`);
			return {
				kind: AcceptMergeRequestResultKind.CanNotBeMerged,
				mergeRequestInfo,
				user,
			};
		}

		console.log(`[MR][${mergeRequestInfo.iid}] source branch is not up to date, rebasing`);
		await tryCancelPipeline(gitlabApi, mergeRequestInfo, user);
		await gitlabApi.rebaseMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid);
		numberOfRebasingRetries--;
		job.updateStatus(JobStatus.REBASING);
		return;
	}

	if (mergeResponse.kind === AcceptMergeRequestResultKind.RebaseInProgress) {
		console.log(`[MR][${mergeRequestInfo.iid}] Still rebasing`);
		job.updateStatus(JobStatus.REBASING);
		return;
	}

	if (mergeResponse.kind === AcceptMergeRequestResultKind.CheckingMergeStatus) {
		console.log(`[MR][${mergeRequestInfo.iid}] Still checking merge status`);
		job.updateStatus(JobStatus.CHECKING_MERGE_STATUS);
		return;
	}

	if (mergeResponse.kind === AcceptMergeRequestResultKind.PipelineInProgress) {
		if (!containsLabel(mergeRequestInfo.labels, BotLabels.WaitingForPipeline)) {
			await setBotLabels(gitlabApi, mergeRequestInfo, [
				BotLabels.Accepting,
				BotLabels.WaitingForPipeline,
			]);
		}

		console.log(
			`[MR][${mergeRequestInfo.iid}] Waiting for CI. Current status: ${mergeResponse.pipeline.status}`,
		);
		job.updateStatus(JobStatus.WAITING_FOR_CI);
		return;
	}

	if (mergeRequestInfo.merge_status !== MergeStatus.CanBeMerged) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] Merge request can't be merged. Merge status is ${mergeRequestInfo.merge_status}`,
		);
		return {
			kind: AcceptMergeRequestResultKind.CanNotBeMerged,
			mergeRequestInfo,
			user,
		};
	}

	let currentPipeline: MergeRequestPipeline | null = mergeRequestInfo.pipeline;

	if (currentPipeline === null || currentPipeline.sha !== mergeRequestInfo.sha) {
		const pipelines = await gitlabApi.getMergeRequestPipelines(
			mergeRequestInfo.project_id,
			mergeRequestInfo.iid,
		);
		if (pipelines.length > 0) {
			const currentPipelineCandidate = pipelines.find(
				(pipeline) => pipeline.sha === mergeRequestInfo.sha,
			);

			if (currentPipelineCandidate === undefined) {
				const message =
					mergeRequestInfo.pipeline === null
						? `[MR][${mergeRequestInfo.iid}] Merge request can't be merged. Pipeline does not exist`
						: `[MR][${mergeRequestInfo.iid}] Merge request can't be merged. The latest pipeline is not executed on the latest commit`;
				console.log(message);

				if (numberOfPipelineValidationRetries > 0) {
					numberOfPipelineValidationRetries--;
					return;
				}

				return {
					kind: AcceptMergeRequestResultKind.InvalidPipeline,
					mergeRequestInfo,
					user,
					pipeline: mergeRequestInfo.pipeline,
				};
			}

			currentPipeline = currentPipelineCandidate;
		}
	}

	if (currentPipeline !== null) {
		if (startingOrInProgressPipelineStatuses.includes(currentPipeline.status)) {
			if (!containsLabel(mergeRequestInfo.labels, BotLabels.WaitingForPipeline)) {
				await setBotLabels(gitlabApi, mergeRequestInfo, [
					BotLabels.Accepting,
					BotLabels.WaitingForPipeline,
				]);
			}

			console.log(
				`[MR][${mergeRequestInfo.iid}] Waiting for CI. Current status: ${currentPipeline.status}`,
			);
			job.updateStatus(JobStatus.WAITING_FOR_CI);
			return;
		}

		if (currentPipeline.status === PipelineStatus.Failed) {
			return {
				kind: AcceptMergeRequestResultKind.FailedPipeline,
				mergeRequestInfo,
				user,
				pipeline: currentPipeline,
			};
		}

		if ([PipelineStatus.Manual, PipelineStatus.Canceled].includes(currentPipeline.status)) {
			if (!config.AUTORUN_MANUAL_BLOCKING_JOBS) {
				return {
					kind: AcceptMergeRequestResultKind.WaitingPipeline,
					mergeRequestInfo,
					user,
					pipeline: currentPipeline,
				};
			}

			const jobs = uniqueNamedJobsByDate(
				await gitlabApi.getPipelineJobs(mergeRequestInfo.project_id, currentPipeline.id),
			);

			const manualJobsToRun = jobs.filter(
				(job) => PipelineJobStatus.Manual === job.status && !job.allow_failure,
			);
			const canceledJobsToRun = jobs.filter(
				(job) => PipelineJobStatus.Canceled === job.status && !job.allow_failure,
			);

			if (manualJobsToRun.length > 0 || canceledJobsToRun.length > 0) {
				console.log(
					`[MR][${mergeRequestInfo.iid}] there are some blocking manual or canceled. triggering again`,
				);
				job.updateStatus(JobStatus.WAITING_FOR_CI);
				await Promise.all(
					manualJobsToRun.map((job) =>
						gitlabApi.runJob(mergeRequestInfo.project_id, job.id),
					),
				);
				await Promise.all(
					canceledJobsToRun.map((job) =>
						gitlabApi.retryJob(mergeRequestInfo.project_id, job.id),
					),
				);
				return;
			}
		}

		if (
			currentPipeline.status !== PipelineStatus.Success &&
			currentPipeline.status !== PipelineStatus.Skipped &&
			currentPipeline.status !== PipelineStatus.Created
		) {
			throw new Error(`Unexpected pipeline status: ${currentPipeline.status}`);
		}
	}

	if (containsLabel(mergeRequestInfo.labels, BotLabels.WaitingForPipeline)) {
		await setBotLabels(gitlabApi, mergeRequestInfo, [BotLabels.Accepting]);
	}
};
