import * as Sentry from '@sentry/node';
import * as env from 'env-var';
import { assignToAuthorAndResetLabels } from './AssignToAuthor';
import { setBotLabels } from './BotLabelsSetter';
import { GitlabApi, MergeRequest, MergeStatus, User } from './GitlabApi';
import {
	runAcceptingMergeRequest,
	AcceptMergeRequestResult,
	AcceptMergeRequestResultKind,
	BotLabels, acceptMergeRequest,
} from './MergeRequestAcceptor';
import { tryCancelPipeline } from './PipelineCanceller';
import { JobPriority } from './Queue';
import { sendNote } from './SendNote';
import { Worker } from './Worker';

const SENTRY_DSN = env.get('SENTRY_DSN').default('').asString();
if (SENTRY_DSN !== '') {
	Sentry.init({ dsn: SENTRY_DSN });
}

const config = {
	GITLAB_URL: env.get('GITLAB_URL').default('https://gitlab.com').asUrlString(),
	GITLAB_AUTH_TOKEN: env.get('GITLAB_AUTH_TOKEN').required().asString(),
	CI_CHECK_INTERVAL: env.get('CI_CHECK_INTERVAL').default('10').asIntPositive() * 1000,
	MR_CHECK_INTERVAL: env.get('MR_CHECK_INTERVAL').default('20').asIntPositive() * 1000,
	REMOVE_BRANCH_AFTER_MERGE: env.get('REMOVE_BRANCH_AFTER_MERGE').default('true').asBoolStrict(),
	SQUASH_MERGE_REQUEST: env.get('SQUASH_MERGE_REQUEST').default('true').asBoolStrict(),
	AUTORUN_MANUAL_BLOCKING_JOBS: env.get('AUTORUN_MANUAL_BLOCKING_JOBS').default('true').asBoolStrict(),
	SKIP_SQUASHING_LABEL: env.get('SKIP_SQUASHING_LABEL').default('bot:skip-squash').asString(),
	HIGH_PRIORITY_LABEL: env.get('HIGH_PRIORITY_LABEL').default('bot:high-priority').asString(),
};

const gitlabApi = new GitlabApi(config.GITLAB_URL, config.GITLAB_AUTH_TOKEN);
const worker = new Worker();

const resolveMergeRequestResult = async (result: AcceptMergeRequestResult) => {
	const mergeRequestInfo = result.mergeRequestInfo;
	const user = result.user;

	if (result.kind === AcceptMergeRequestResultKind.SuccessfullyMerged) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is merged, ending`);
		await setBotLabels(gitlabApi, mergeRequestInfo, []);
		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.CanNotBeMerged) {
		let message = 'Merge request can\'t be merged';
		const errorMessage = mergeRequestInfo.merge_error;
		if (mergeRequestInfo.work_in_progress) {
			message += `: MR is marked as WIP`;
		} else if (errorMessage !== null) {
			message += `: ${errorMessage}`;
		}

		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.HasConflict) {
		console.log(`[MR][${mergeRequestInfo.iid}] MR has conflict`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, 'Merge request can\'t be merged: MR has conflict'),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.ClosedMergeRequest) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is closed, ending`);

		await Promise.all([
			tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
			setBotLabels(gitlabApi, mergeRequestInfo, []),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.ReassignedMergeRequest) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is assigned to different user, ending`);

		await Promise.all([
			tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
			setBotLabels(gitlabApi, mergeRequestInfo, []),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.FailedPipeline) {
		console.log(`[MR][${mergeRequestInfo.iid}] pipeline is in failed state: ${result.pipeline.status}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, `Merge request can't be merged due to failing pipeline`),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.WaitingPipeline) {
		console.log(`[MR][${mergeRequestInfo.iid}] pipeline is waiting for a manual action: ${result.pipeline.status}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, `Merge request can't be merged. Pipeline is waiting for a manual user action.`),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.WaitingForApprovals) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is waiting for approvals, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, `Merge request is waiting for approvals. Required ${result.approvals.approvals_required}, but ${result.approvals.approvals_left} left.`),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.UnresolvedDiscussion) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request has unresolved discussion, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, `Merge request has unresolved discussion, I can't merge it`),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.InvalidPipeline) {
		const message = result.pipeline === null
			? `Merge request can't be merged. Pipeline does not exist`
			: `Merge request can't be merged. The latest pipeline is not executed on the latest commit`;

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.Unauthorized) {
		console.log(`[MR][${mergeRequestInfo.iid}] You don't have permissions to accept this merge request, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, `Merge request can't be merged due to insufficient authorization`),
		]);

		return;
	}
};

const runMergeRequestCheckerLoop = async (user: User) => {
	console.log('[loop] Checking assigned merge requests');
	const assignedMergeRequests = await gitlabApi.getAssignedOpenedMergeRequests();
	const possibleToAcceptMergeRequests = assignedMergeRequests.map(async (mergeRequest: MergeRequest) => {
		if (
			mergeRequest.merge_status !== MergeStatus.CanBeMerged
			&& mergeRequest.merge_status !== MergeStatus.Checking
		) {
			console.log(`[loop][MR][${mergeRequest.iid}] Merge request can't be merged. Merge status is ${mergeRequest.merge_status}, assigning back`);

			await Promise.all([
				assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
				sendNote(gitlabApi, mergeRequest, `Merge request can't be merged. Probably it needs rebase to target branch.`),
			]);

			return;
		}

		if (mergeRequest.work_in_progress) {
			console.log(`[loop][MR][${mergeRequest.iid}] Merge request is WIP, assigning back`);

			await Promise.all([
				assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
				sendNote(gitlabApi, mergeRequest, `Merge request is marked as WIP, I can't merge it`),
			]);

			return;
		}

		if (!mergeRequest.blocking_discussions_resolved) {
			console.log(`[loop][MR][${mergeRequest.iid}] Merge request has unresolved discussion, assigning back`);

			await Promise.all([
				assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
				sendNote(gitlabApi, mergeRequest, `Merge request has unresolved discussion, I can't merge it`),
			]);

			return;
		}

		if (mergeRequest.has_conflicts) {
			console.log(`[loop][MR][${mergeRequest.iid}] MR has conflict`);

			await Promise.all([
				assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
				sendNote(gitlabApi, mergeRequest, 'Merge request can\'t be merged: MR has conflict'),
			]);

			return;
		}

		const approvals = await gitlabApi.getMergeRequestApprovals(mergeRequest.project_id, mergeRequest.iid);
		if (approvals.approvals_left > 0) {
			console.log(`[loop][MR][${mergeRequest.iid}] Merge request is waiting for approvals, assigning back`);

			await Promise.all([
				assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
				sendNote(gitlabApi, mergeRequest, `Merge request is waiting for approvals. Required ${approvals.approvals_required}, but ${approvals.approvals_left} left.`),
			]);

			return;
		}

		const jobPriority = mergeRequest.labels.includes(config.HIGH_PRIORITY_LABEL) ? JobPriority.HIGH : JobPriority.NORMAL;
		const jobId = `accept-merge-${mergeRequest.id}`;

		const currentJobPriority = worker.findJobPriorityInQueue(mergeRequest.target_project_id, jobId);
		if (currentJobPriority === jobPriority) {
			return;
		}

		const options = {
			ciInterval: config.CI_CHECK_INTERVAL,
			removeBranchAfterMerge: config.REMOVE_BRANCH_AFTER_MERGE,
			squashMergeRequest: config.SQUASH_MERGE_REQUEST,
			skipSquashingLabel: config.SKIP_SQUASHING_LABEL,
			autorunManualBlockingJobs: config.AUTORUN_MANUAL_BLOCKING_JOBS,
		};

		if (jobPriority === JobPriority.HIGH) {
			const mergeResponse = await acceptMergeRequest(gitlabApi, mergeRequest, user, options);
			if (mergeResponse.kind === AcceptMergeRequestResultKind.SuccessfullyMerged) {
				console.log(`[loop][MR][${mergeRequest.iid}] High-priority merge request is merged`);
				return;
			}
			console.log(`[loop][MR][${mergeRequest.iid}] High-priority merge request is not acceptable in this moment.`);
		}

		if (currentJobPriority !== null) {
			console.log(`[loop][MR][${mergeRequest.iid}] Changing job priority to ${jobPriority}.`);
			worker.setJobPriority(
				mergeRequest.target_project_id,
				jobId,
				jobPriority,
			);
			return;
		}

		console.log(`[loop][MR][${mergeRequest.iid}] Adding job to the queue with ${jobPriority} priority.`);
		worker.addJobToQueue(
			mergeRequest.target_project_id,
			jobPriority,
			jobId,
			() => runAcceptingMergeRequest(gitlabApi, mergeRequest, user, options),
		).then(resolveMergeRequestResult);

		await setBotLabels(gitlabApi, mergeRequest, [BotLabels.InMergeQueue]);
	});

	await Promise.all(possibleToAcceptMergeRequests);

	setTimeout(() => runMergeRequestCheckerLoop(user), config.MR_CHECK_INTERVAL);
};

const printConfig = () => {
	console.log(`Configuration:`);
	console.log(JSON.stringify({
		...config,
		GITLAB_AUTH_TOKEN: '*******',
	}, null, 4));
};

(async () => {
	printConfig();
	const user = await gitlabApi.getMe();
	console.log(`[bot] Hi, I'm ${user.name}. I'll accept merge request assigned to me.`);

	await runMergeRequestCheckerLoop(user);
})();
