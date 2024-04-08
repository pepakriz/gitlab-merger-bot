import {
	DetailedMergeStatus,
	GitlabApi,
	MergeRequest,
	MergeRequestInfo,
	MergeState,
	PipelineJob,
	PipelineJobStatus,
	PipelineStatus,
	RequestMethod,
	User,
} from './GitlabApi';
import { tryCancelPipeline } from './PipelineCanceller';
import { setBotLabels } from './BotLabelsSetter';
import { Config } from './Config';
import { Job } from './Job';
import { JobStatus } from './generated/graphqlgen';
import { assignToAuthorAndResetLabels } from './AssignToAuthor';
import { sendNote } from './SendNote';

export enum BotLabels {
	InMergeQueue = 'in-merge-queue',
	Accepting = 'accepting',
	WaitingForPipeline = 'waiting-for-pipeline',
}

const containsLabel = (labels: string[], label: BotLabels) => labels.includes(label);
export const containsAssignedUser = (mergeRequest: MergeRequest, user: User) => {
	const userIds = mergeRequest.assignees.map((assignee) => assignee.id);
	return userIds.includes(user.id);
};

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
	job: Job,
	gitlabApi: GitlabApi,
	projectId: number,
	mergeRequestIid: number,
	user: User,
	config: Config,
): Promise<'continue' | 'done'> => {
	console.log(`[MR][${mergeRequestIid}] Checking...`);

	const mergeRequestInfo = await gitlabApi.getMergeRequestInfo(projectId, mergeRequestIid);
	if (mergeRequestInfo.state === MergeState.Merged) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is merged, ending`);
		await setBotLabels(gitlabApi, mergeRequestInfo, []);

		return 'done';
	}

	if (!containsAssignedUser(mergeRequestInfo, user)) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] Merge request is assigned to different user, ending`,
		);
		await setBotLabels(gitlabApi, mergeRequestInfo, []);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.NotOpen) {
		const message = 'The merge request is not open anymore.';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.DiscussionsNotResolved) {
		const message = "The merge request has unresolved discussion, I can't merge it.";
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.DraftStatus) {
		const message = 'The merge request is marked as a draft';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.RequestedChanges) {
		const message = 'The merge request has Reviewers who have requested changes';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.JiraAssociationMissing) {
		const message = 'The merge request title or description must reference a Jira issue.';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.ExternalStatusChecks) {
		const message = 'All external status checks must pass before merge.';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.BlockedStatus) {
		const message = 'The merge request is blocked by another merge request';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.Conflict) {
		const message = 'The merge request has conflict';
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.NotApproved) {
		const approvals = await gitlabApi.getMergeRequestApprovals(
			mergeRequestInfo.target_project_id,
			mergeRequestInfo.iid,
		);
		const message = `The merge request is waiting for approvals. Required ${approvals.approvals_required}, but ${approvals.approvals_left} left.`;
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (
		mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.Checking ||
		mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.Unchecked
	) {
		console.log(`[MR][${mergeRequestInfo.iid}] Still checking merge status`);
		job.updateStatus(JobStatus.CHECKING_MERGE_STATUS);
		return 'continue';
	}

	if (mergeRequestInfo.rebase_in_progress) {
		console.log(`[MR][${mergeRequestInfo.iid}] Still rebasing`);
		job.updateStatus(JobStatus.REBASING);
		return 'continue';
	}

	if (
		mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.NeedsRebase ||
		mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.NeedRebase
	) {
		console.log(`[MR][${mergeRequestInfo.iid}] source branch is not up to date, rebasing`);
		await tryCancelPipeline(gitlabApi, mergeRequestInfo, user);
		await gitlabApi.rebaseMergeRequest(
			mergeRequestInfo.target_project_id,
			mergeRequestInfo.iid,
		);
		job.updateStatus(JobStatus.REBASING);
		return 'continue';
	}

	const currentPipeline = mergeRequestInfo.head_pipeline;
	if (currentPipeline === null) {
		const message = `The merge request can't be merged. Pipeline does not exist`;
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (currentPipeline.status === PipelineStatus.Failed) {
		const message = `The merge request can't be merged due to failing pipeline`;
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (currentPipeline.status === PipelineStatus.Skipped) {
		const message = `The merge request can't be merged due to skipped pipeline`;
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (
		mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.CiMustPass &&
		[PipelineStatus.Manual, PipelineStatus.Canceled].includes(currentPipeline.status)
	) {
		const jobs = uniqueNamedJobsByDate(
			await gitlabApi.getPipelineJobs(mergeRequestInfo.target_project_id, currentPipeline.id),
		);

		// Mark pipeline as failed when a failed job is found
		const failedJob = jobs.find(
			(job) => !job.allow_failure && job.status === PipelineJobStatus.Failed,
		);
		if (failedJob !== undefined) {
			console.log(
				`[MR][${mergeRequestInfo.iid}] job in pipeline is in failed state: ${currentPipeline.status}, assigning back`,
			);

			await Promise.all([
				assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
				sendNote(
					gitlabApi,
					mergeRequestInfo,
					`The merge request can't be merged due to failing pipeline`,
				),
			]);

			return 'done';
		}

		const manualJobsToRun = jobs.filter(
			(job) => PipelineJobStatus.Manual === job.status && !job.allow_failure,
		);
		const canceledJobsToRun = jobs.filter(
			(job) => PipelineJobStatus.Canceled === job.status && !job.allow_failure,
		);

		if (manualJobsToRun.length > 0 || canceledJobsToRun.length > 0) {
			if (!config.AUTORUN_MANUAL_BLOCKING_JOBS) {
				console.log(
					`[MR][${mergeRequestInfo.iid}] pipeline is waiting for a manual action: ${currentPipeline.status}, assigning back`,
				);

				await Promise.all([
					assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
					sendNote(
						gitlabApi,
						mergeRequestInfo,
						`The merge request can't be merged. Pipeline is waiting for a manual user action.`,
					),
				]);

				return 'done';
			}

			console.log(
				`[MR][${mergeRequestInfo.iid}] there are some blocking manual or canceled. triggering again`,
			);
			job.updateStatus(JobStatus.WAITING_FOR_CI);
			await Promise.all(
				manualJobsToRun.map((job) =>
					gitlabApi.runJob(mergeRequestInfo.target_project_id, job.id),
				),
			);
			await Promise.all(
				canceledJobsToRun.map((job) =>
					gitlabApi.retryJob(mergeRequestInfo.target_project_id, job.id),
				),
			);
			return 'continue';
		}
	}

	if (
		mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.CiStillRunning ||
		// I don't understand why the merge status is `ci_must_pass` instead of `ci_still_running`, but it is as it is. Maybe more values for currentPipeline.status should be added here, but let's try it in this way for now.
		(mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.CiMustPass &&
			[PipelineStatus.Running, PipelineStatus.Created].includes(currentPipeline.status))
	) {
		await setBotLabels(gitlabApi, mergeRequestInfo, [BotLabels.WaitingForPipeline]);
		return 'continue';
	}

	if (mergeRequestInfo.detailed_merge_status !== DetailedMergeStatus.Mergeable) {
		const message = `The merge request can't be merged due to unexpected status. Merge status: ${mergeRequestInfo.detailed_merge_status} and pipeline status: ${currentPipeline.status}`;
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (mergeRequestInfo.merge_error !== null) {
		const message = `The merge request can't be merged: ${mergeRequestInfo.merge_error}`;
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return 'done';
	}

	if (!containsLabel(mergeRequestInfo.labels, BotLabels.Accepting)) {
		await setBotLabels(gitlabApi, mergeRequestInfo, [BotLabels.Accepting]);
	}

	if (config.DRY_RUN) {
		console.log(`[MR][${mergeRequestInfo.iid}] Still checking merge status`);
		job.updateStatus(JobStatus.CHECKING_MERGE_STATUS);
		return 'continue';
	}

	return mergeMergeRequest({
		mergeRequestInfo,
		job,
		gitlabApi,
		config,
		user,
	});
};

export const mergeMergeRequest = async ({
	mergeRequestInfo,
	job,
	gitlabApi,
	config,
	user,
}: {
	mergeRequestInfo: MergeRequestInfo;
	job?: Job;
	gitlabApi: GitlabApi;
	config: Config;
	user: User;
}) => {
	// Let's merge it
	const useSquash = mergeRequestInfo.labels.includes(config.SKIP_SQUASHING_LABEL)
		? false
		: config.SQUASH_MERGE_REQUEST;
	if (mergeRequestInfo.squash && !useSquash) {
		// Because usage `squash=false` during accept MR has no effect and it just uses squash setting from the MR
		await gitlabApi.updateMergeRequest(
			mergeRequestInfo.target_project_id,
			mergeRequestInfo.iid,
			{
				squash: false,
			},
		);
	}

	type BodyStructure = {
		should_remove_source_branch: boolean;
		sha: string;
		squash: boolean;
		squash_commit_message?: string;
		merge_commit_message?: string;
	};

	const requestBody: BodyStructure = {
		should_remove_source_branch: config.REMOVE_BRANCH_AFTER_MERGE,
		sha: mergeRequestInfo.diff_refs.head_sha,
		squash: useSquash,
	};

	if (!config.PREFER_GITLAB_TEMPLATE) {
		requestBody.squash_commit_message = `${mergeRequestInfo.title} (!${mergeRequestInfo.iid})`;
		requestBody.merge_commit_message = `${mergeRequestInfo.title} (!${mergeRequestInfo.iid})`;
	}

	const response = await gitlabApi.sendRawRequest(
		`/api/v4/projects/${mergeRequestInfo.target_project_id}/merge_requests/${mergeRequestInfo.iid}/merge`,
		RequestMethod.Put,
		requestBody,
	);

	if (response.status === 405 || response.status === 406) {
		// GitLab 405 is a mixed state and can be a temporary error
		// as long as all flags and status indicate that we can merge, retry
		if (mergeRequestInfo.detailed_merge_status === DetailedMergeStatus.Mergeable) {
			console.log(
				`[MR][${mergeRequestInfo.iid}] ${response.status} - cannot be merged but merge status is: ${mergeRequestInfo.detailed_merge_status}`,
			);

			if (job) {
				job.updateStatus(JobStatus.CHECKING_MERGE_STATUS);
			}
		}

		return 'continue';
	}

	if (response.status === 409) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] ${response.status} - SHA does not match HEAD of source branch`,
		);
		return 'continue';
	}

	if (response.status === 401) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] You don't have permissions to accept this merge request, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(
				gitlabApi,
				mergeRequestInfo,
				`The merge request can't be merged due to insufficient authorization`,
			),
		]);

		return 'done';
	}

	if (response.status !== 200) {
		throw new Error(`Unsupported response status ${response.status}`);
	}

	const data = await response.json();
	if (typeof data !== 'object' && data.id === undefined) {
		console.error('response', data);
		throw new Error('Invalid response');
	}

	return 'done';
};
