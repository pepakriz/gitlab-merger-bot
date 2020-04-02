import {
	GitlabApi,
	MergeRequest,
	MergeRequestApprovals,
	MergeRequestInfo,
	MergeRequestPipeline,
	MergeState,
	MergeStatus,
	PipelineJobStatus,
	PipelineStatus,
	RequestMethod,
	User,
} from './GitlabApi';
import { tryCancelPipeline } from './PipelineCanceller';
import { sleep } from './Utils';

export enum AcceptMergeRequestResultKind {
	SuccessfullyMerged,
	ClosedMergeRequest,
	ReassignedMergeRequest,
	CanNotBeMerged,
	HasConflict,
	FailedPipeline,
	InvalidPipeline,
	WaitingPipeline,
	WaitingForApprovals,
	UnresolvedDiscussion,
	Unauthorized,
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

export type AcceptMergeRequestResult = SuccessResponse
	| ClosedMergeRequestResponse
	| ReassignedMergeRequestResponse
	| CanNotBeMergedResponse
	| HasConflictResponse
	| FailedPipelineResponse
	| InvalidPipelineResponse
	| WaitingPipelineResponse
	| WaitingForApprovalsResponse
	| UnresolvedDiscussionResponse
	| UnauthorizedResponse;

interface AcceptMergeRequestOptions {
	ciInterval: number;
	removeBranchAfterMerge: boolean;
	squashMergeRequest: boolean;
	skipSquashingLabel: string;
	autorunManualBlockingJobs: boolean;
}

export enum BotLabels {
	InMergeQueue = 'in-merge-queue',
	Rebasing = 'rebasing',
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

export const acceptMergeRequest = async (gitlabApi: GitlabApi, mergeRequest: MergeRequest, user: User, options: AcceptMergeRequestOptions): Promise<AcceptMergeRequestResult> => {
	let mergeRequestInfo: MergeRequestInfo;
	let numberOfPipelineValidationRetries = defaultPipelineValidationRetries;
	let numberOfRebasingRetries = defaultRebasingRetries;

	while (true) {
		const tasks: Promise<any>[] = [sleep(options.ciInterval)];
		mergeRequestInfo = await gitlabApi.getMergeRequestInfo(mergeRequest.project_id, mergeRequest.iid);

		if (!containsAssignedUser(mergeRequestInfo, user)) {
			return {
				kind: AcceptMergeRequestResultKind.ReassignedMergeRequest,
				mergeRequestInfo,
				user,
			};
		}

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

		if (!mergeRequest.blocking_discussions_resolved) {
			return {
				kind: AcceptMergeRequestResultKind.UnresolvedDiscussion,
				mergeRequestInfo,
				user,
			};
		}

		const approvals = await gitlabApi.getMergeRequestApprovals(mergeRequestInfo.project_id, mergeRequestInfo.iid);
		if (approvals.approvals_left > 0) {
			return {
				kind: AcceptMergeRequestResultKind.WaitingForApprovals,
				mergeRequestInfo,
				user,
				approvals,
			};
		}

		if (mergeRequestInfo.rebase_in_progress) {
			console.log(`[MR][${mergeRequestInfo.iid}] Still rebasing`);
			await Promise.all(tasks);
			continue;
		}

		if (mergeRequestInfo.merge_status === MergeStatus.Checking) {
			console.log(`[MR][${mergeRequestInfo.iid}] Still checking merge status`);
			await Promise.all(tasks);
			continue;
		}

		if (mergeRequest.has_conflicts) {
			return {
				kind: AcceptMergeRequestResultKind.HasConflict,
				mergeRequestInfo,
				user,
			};
		}

		if (mergeRequestInfo.work_in_progress) {
			console.log(`[MR][${mergeRequestInfo.iid}] Merge request can't be merged. Merge request is still in progress`);
			return {
				kind: AcceptMergeRequestResultKind.CanNotBeMerged,
				mergeRequestInfo,
				user,
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

			await gitlabApi.updateMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid, {
				labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.Rebasing].join(','),
			});
			console.log(`[MR][${mergeRequestInfo.iid}] source branch is not up to date, rebasing`);
			await tryCancelPipeline(gitlabApi, mergeRequestInfo, user);
			await gitlabApi.rebaseMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid);
			numberOfPipelineValidationRetries = defaultPipelineValidationRetries;
			numberOfRebasingRetries--;
			await Promise.all(tasks);
			continue;
		}

		if (mergeRequestInfo.merge_status !== MergeStatus.CanBeMerged) {
			console.log(`[MR][${mergeRequestInfo.iid}] Merge request can't be merged. Merge status is ${mergeRequestInfo.merge_status}`);
			return {
				kind: AcceptMergeRequestResultKind.CanNotBeMerged,
				mergeRequestInfo,
				user,
			};
		}

		if (containsLabel(mergeRequestInfo.labels, BotLabels.Rebasing)) {
			await gitlabApi.updateMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid, {
				labels: [...filterBotLabels(mergeRequestInfo.labels)].join(','),
			});
		}

		let currentPipeline: MergeRequestPipeline | null = mergeRequestInfo.pipeline;

		if (currentPipeline === null || currentPipeline.sha !== mergeRequestInfo.sha) {
			const pipelines = await gitlabApi.getMergeRequestPipelines(mergeRequestInfo.project_id, mergeRequestInfo.iid);
			if (pipelines.length > 0) {
				const currentPipelineCandidate = pipelines.find((pipeline) => pipeline.sha === mergeRequestInfo.sha);

				if (currentPipelineCandidate === undefined) {
					const message = mergeRequestInfo.pipeline === null
						? `[MR][${mergeRequestInfo.iid}] Merge request can't be merged. Pipeline does not exist`
						: `[MR][${mergeRequestInfo.iid}] Merge request can't be merged. The latest pipeline is not executed on the latest commit`;
					console.log(message);

					if (numberOfPipelineValidationRetries > 0) {
						numberOfPipelineValidationRetries--;
						await Promise.all(tasks);
						continue;
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
					tasks.push(
						gitlabApi.updateMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid, {
							labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.WaitingForPipeline].join(','),
						}),
					);
				}

				console.log(`[MR][${mergeRequestInfo.iid}] Waiting for CI. Current status: ${currentPipeline.status}`);
				await Promise.all(tasks);
				continue;
			}

			if (currentPipeline.status === PipelineStatus.Canceled) {
				console.log(`[MR][${mergeRequestInfo.iid}] pipeline is canceled calling retry`);
				await gitlabApi.retryPipeline(mergeRequestInfo.project_id, currentPipeline.id);
				numberOfPipelineValidationRetries = defaultPipelineValidationRetries;
				await Promise.all(tasks);
				continue;
			}

			if (currentPipeline.status === PipelineStatus.Failed) {
				return {
					kind: AcceptMergeRequestResultKind.FailedPipeline,
					mergeRequestInfo,
					user,
					pipeline: currentPipeline,
				};
			}

			if (options.autorunManualBlockingJobs && currentPipeline.status === PipelineStatus.Manual) {
				const jobs = await gitlabApi.getPipelineJobs(mergeRequestInfo.project_id, currentPipeline.id);
				const jobsToRun = jobs.filter((job) => job.status === PipelineJobStatus.Manual && !job.allow_failure);

				if (jobsToRun.length > 0) {
					console.log(`[MR][${mergeRequestInfo.iid}] there are some blocking manual jobs. triggering`);
					await Promise.all(jobsToRun.map((job) => gitlabApi.runJob(mergeRequestInfo.project_id, job.id)));
					await Promise.all(tasks);
					continue;
				}
			}

			if (currentPipeline.status === PipelineStatus.Manual) {
				return {
					kind: AcceptMergeRequestResultKind.WaitingPipeline,
					mergeRequestInfo,
					user,
					pipeline: currentPipeline,
				};
			}

			if (
				currentPipeline.status !== PipelineStatus.Success
				&& currentPipeline.status !== PipelineStatus.Skipped
				&& currentPipeline.status !== PipelineStatus.Created
			) {
				throw new Error(`Unexpected pipeline status: ${currentPipeline.status}`);
			}
		}

		console.log(`[MR][${mergeRequestInfo.iid}] Calling merge request`);
		const response = await gitlabApi.sendRawRequest(`/api/v4/projects/${mergeRequestInfo.project_id}/merge_requests/${mergeRequestInfo.iid}/merge`, RequestMethod.Put, {
			should_remove_source_branch: options.removeBranchAfterMerge,
			sha: mergeRequestInfo.diff_refs.head_sha,
			squash: mergeRequestInfo.labels.includes(options.skipSquashingLabel) ? false : options.squashMergeRequest,
			squash_commit_message: `${mergeRequestInfo.title} (!${mergeRequestInfo.iid})`,
			merge_commit_message: `${mergeRequestInfo.title} (!${mergeRequestInfo.iid})`,
		});

		if (response.status === 405) {
			console.log(`[MR][${mergeRequestInfo.iid}] 405 - cannot be merged`);
			continue;
		}

		if (response.status === 406) {
			console.log(`[MR][${mergeRequestInfo.iid}] 406 - already merged`);
			continue;
		}

		if (response.status === 409) {
			console.log(`[MR][${mergeRequestInfo.iid}] 409 - SHA does not match HEAD of source branch`);
			continue;
		}

		if (response.status === 401) {
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

		if (!containsLabel(mergeRequestInfo.labels, BotLabels.Accepting)) {
			tasks.push(
				gitlabApi.updateMergeRequest(mergeRequestInfo.project_id, mergeRequestInfo.iid, {
					labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.Accepting].join(','),
				}),
			);
		}

		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is processing`);
		await Promise.all(tasks);
	}
};
