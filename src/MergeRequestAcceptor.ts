import {
	GitlabApi,
	MergeRequest,
	MergeRequestInfo, MergeRequestPipeline,
	MergeState,
	MergeStatus,
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
	RebaseFailed,
	FailedPipeline,
	InvalidPipeline,
	Unauthorized,
}

interface SuccessResponse {
	kind: AcceptMergeRequestResultKind.SuccessfullyMerged;
	mergeRequestInfo: MergeRequestInfo;
}

interface ClosedMergeRequestResponse {
	kind: AcceptMergeRequestResultKind.ClosedMergeRequest;
	mergeRequestInfo: MergeRequestInfo;
}

interface ReassignedMergeRequestResponse {
	kind: AcceptMergeRequestResultKind.ReassignedMergeRequest;
	mergeRequestInfo: MergeRequestInfo;
}

interface CanNotBeMergedResponse {
	kind: AcceptMergeRequestResultKind.CanNotBeMerged;
	mergeRequestInfo: MergeRequestInfo;
}

interface FailedPipelineResponse {
	kind: AcceptMergeRequestResultKind.FailedPipeline;
	mergeRequestInfo: MergeRequestInfo;
	pipeline: MergeRequestPipeline;
}

interface InvalidPipelineResponse {
	kind: AcceptMergeRequestResultKind.InvalidPipeline;
	mergeRequestInfo: MergeRequestInfo;
	pipeline: MergeRequestPipeline | null;
}

interface UnauthorizedResponse {
	kind: AcceptMergeRequestResultKind.Unauthorized;
	mergeRequestInfo: MergeRequestInfo;
}

interface RebaseFailedResponse {
	kind: AcceptMergeRequestResultKind.RebaseFailed;
	mergeRequestInfo: MergeRequestInfo;
}

type AcceptMergeRequestResult = SuccessResponse
	| ClosedMergeRequestResponse
	| ReassignedMergeRequestResponse
	| CanNotBeMergedResponse
	| RebaseFailedResponse
	| FailedPipelineResponse
	| InvalidPipelineResponse
	| UnauthorizedResponse;

interface AcceptMergeRequestOptions {
	ciInterval: number;
}

export enum BotLabels {
	InMergeQueue = 'in-merge-queue',
	Rebasing = 'rebasing',
	Accepting = 'accepting',
	WaitingForPipeline = 'waiting-for-pipeline',
}

const containsLabel = (labels: string[], label: BotLabels) => labels.includes(label);
const defaultPipelineValidationRetries = 5;

export const filterBotLabels = (labels: string[]) => {
	const values = Object.values(BotLabels);

	return labels.filter((label) => !values.includes(label));
};

export const acceptMergeRequest = async (gitlabApi: GitlabApi, mergeRequest: MergeRequest, user: User, options: AcceptMergeRequestOptions): Promise<AcceptMergeRequestResult> => {
	let mergeRequestInfo: MergeRequestInfo;
	let numberOfPipelineValidationRetries = defaultPipelineValidationRetries;

	while (true) {
		const tasks: Array<Promise<any>> = [sleep(options.ciInterval)];
		mergeRequestInfo = await gitlabApi.getMergeRequestInfo(mergeRequest.project_id, mergeRequest.iid);

		if (mergeRequestInfo.assignee !== null && mergeRequestInfo.assignee.id !== user.id) {
			return {
				kind: AcceptMergeRequestResultKind.ReassignedMergeRequest,
				mergeRequestInfo,
			};
		}

		if (mergeRequestInfo.state === MergeState.Merged) {
			return {
				kind: AcceptMergeRequestResultKind.SuccessfullyMerged,
				mergeRequestInfo,
			};
		}

		if (mergeRequestInfo.state === MergeState.Closed) {
			return {
				kind: AcceptMergeRequestResultKind.ClosedMergeRequest,
				mergeRequestInfo,
			};
		}

		if (mergeRequestInfo.state !== MergeState.Opened) {
			throw new Error(`Unexpected MR status: ${mergeRequestInfo.state}`);
		}

		if (mergeRequestInfo.merge_error !== null) {
			return {
				kind: AcceptMergeRequestResultKind.RebaseFailed,
				mergeRequestInfo,
			};
		}

		if (mergeRequestInfo.rebase_in_progress) {
			console.log(`[MR] Still rebasing`);
			await Promise.all(tasks);
			continue;
		}

		if (mergeRequestInfo.merge_status !== MergeStatus.CanBeMerged || mergeRequestInfo.work_in_progress) {
			return {
				kind: AcceptMergeRequestResultKind.CanNotBeMerged,
				mergeRequestInfo,
			};
		}

		if (mergeRequestInfo.diverged_commits_count > 0) {
			await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
				labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.Rebasing].join(','),
			});
			console.log(`[MR] source branch is not up to date, rebasing`);
			await Promise.all([
				tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
				gitlabApi.rebaseMergeRequest(mergeRequest.project_id, mergeRequest.iid),
			]);
			await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
				labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.Accepting].join(','),
			});
			numberOfPipelineValidationRetries = defaultPipelineValidationRetries;
			continue;
		}

		let currentPipeline: MergeRequestPipeline | null = mergeRequestInfo.pipeline;

		if (currentPipeline === null || currentPipeline.sha !== mergeRequestInfo.sha) {
			const pipelines = await gitlabApi.getMergeRequestPipelines(mergeRequest.project_id, mergeRequest.iid);
			const currentPipelineCandidate = pipelines.find((pipeline) => pipeline.sha === mergeRequestInfo.sha);

			if (currentPipelineCandidate === undefined) {
				const message = mergeRequestInfo.pipeline === null
					? `[MR] Merge request can't be merged. Pipeline does not exist`
					: `[MR] Merge request can't be merged. The latest pipeline is not executed on the latest commit`;
				console.log(message);

				if (numberOfPipelineValidationRetries > 0) {
					numberOfPipelineValidationRetries--;
					await Promise.all(tasks);
					continue;
				}

				return {
					kind: AcceptMergeRequestResultKind.InvalidPipeline,
					mergeRequestInfo,
					pipeline: mergeRequestInfo.pipeline,
				};
			}

			currentPipeline = currentPipelineCandidate;
		}

		if (currentPipeline.status === PipelineStatus.Running || currentPipeline.status === PipelineStatus.Pending) {
			if (!containsLabel(mergeRequestInfo.labels, BotLabels.WaitingForPipeline)) {
				tasks.push(
					gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
						labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.WaitingForPipeline].join(','),
					}),
				);
			}

			console.log(`[MR] Waiting for CI. Current status: ${currentPipeline.status}`);
			await Promise.all(tasks);
			continue;
		}

		if (currentPipeline.status === PipelineStatus.Canceled) {
			console.log(`[MR] pipeline is canceled calling retry`);
			await gitlabApi.retryPipeline(mergeRequest.project_id, currentPipeline.id);
			numberOfPipelineValidationRetries = defaultPipelineValidationRetries;
			continue;
		}

		if (currentPipeline.status === PipelineStatus.Failed) {
			return {
				kind: AcceptMergeRequestResultKind.FailedPipeline,
				mergeRequestInfo,
				pipeline: currentPipeline,
			};
		}

		if (currentPipeline.status !== PipelineStatus.Success) {
			throw new Error(`Unexpected pipeline status: ${currentPipeline.status}`);
		}

		console.log('[MR] Calling merge request');
		const response = await gitlabApi.sendRawRequest(`/api/v4/projects/${mergeRequest.project_id}/merge_requests/${mergeRequest.iid}/merge`, RequestMethod.Put, {
			should_remove_source_branch: true,
			merge_when_pipeline_succeeds: true,
			sha: mergeRequestInfo.diff_refs.head_sha,
			squash_commit_message: `${mergeRequest.title} (#${mergeRequest.iid})`,
		});

		if (response.status === 405) { // cannot be merged
			continue;
		}

		if (response.status === 406) { // already merged
			continue;
		}

		if (response.status === 409) { // SHA does not match HEAD of source branch
			continue;
		}

		if (response.status === 401) {
			return {
				kind: AcceptMergeRequestResultKind.Unauthorized,
				mergeRequestInfo,
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
				gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
					labels: [...filterBotLabels(mergeRequestInfo.labels), BotLabels.Accepting].join(','),
				}),
			);
		}

		console.log(`[MR] Merge request is processing`);
		await Promise.all(tasks);
	}
};
