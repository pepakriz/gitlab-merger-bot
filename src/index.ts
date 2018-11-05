import * as env from 'env-var';
import * as fs from 'fs';
import { assignToAuthor } from './AssignToAuthor';
import {
	DiscussionNote,
	GitlabApi,
	MergeRequest,
	MergeRequestDiscussion,
	MergeStatus,
	User,
} from './GitlabApi';
import { acceptMergeRequest, AcceptMergeRequestResultKind } from './MergeRequestAcceptor';
import { tryCancelPipeline } from './PipelineCanceller';
import { sendNote } from './SendNote';
import { Worker } from './Worker';

process.on('unhandledRejection', (error) => {
	console.error('unhandledRejection', error);
	process.exit(1);
});

const GITLAB_URL = env.get('GITLAB_URL', 'https://gitlab.com').asUrlString();
const GITLAB_AUTH_TOKEN = env.get('GITLAB_AUTH_TOKEN').required().asString();
const CI_CHECK_INTERVAL = env.get('CI_CHECK_INTERVAL', '10').asIntPositive() * 1000;
const MR_CHECK_INTERVAL = env.get('MR_CHECK_INTERVAL', '20').asIntPositive() * 1000;
const REMOVE_BRANCH_AFTER_MERGE = env.get('REMOVE_BRANCH_AFTER_MERGE', 'true').asBool();
const dataDir = env.get('DATA_DIR', `${__dirname}/../data`).asString();

if (!fs.existsSync(dataDir)) {
	throw new Error(`Data directory ${dataDir} does not exist`);
}

const gitlabApi = new GitlabApi(GITLAB_URL, GITLAB_AUTH_TOKEN, `${dataDir}/repository`);
const worker = new Worker();

const runMergeRequestCheckerLoop = async (user: User) => {
	console.log('[bot] Checking assigned merge requests');
	const assignedMergeRequests = await gitlabApi.getAssignedOpenedMergeRequests();
	const possibleToAcceptMergeRequests = assignedMergeRequests.map(async (mergeRequest: MergeRequest) => {
		if (REMOVE_BRANCH_AFTER_MERGE && !mergeRequest.force_remove_source_branch) {
			console.log(`[MR] Marking MR to be removed after merge`);
			await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
				remove_source_branch: true,
			});
		}

		if (mergeRequest.merge_status !== MergeStatus.CanBeMerged) {
			console.log(`[MR] Branch cannot be merged. Probably it needs rebase to target branch, assigning back`);

			await Promise.all([
				assignToAuthor(gitlabApi, mergeRequest),
				sendNote(gitlabApi, mergeRequest, `Merge request can't be merged. Probably it needs rebase to target branch.`),
			]);

			return;
		}

		if (mergeRequest.work_in_progress) {
			console.log(`[MR] Merge request is WIP, assigning back`);

			await Promise.all([
				assignToAuthor(gitlabApi, mergeRequest),
				sendNote(gitlabApi, mergeRequest, `Merge request is marked as WIP, I can't merge it`),
			]);

			return;
		}

		const mergeRequestDiscussions = await gitlabApi.getMergeRequestDiscussions(mergeRequest.project_id, mergeRequest.iid);
		const unresolvedDiscussion = mergeRequestDiscussions.find((mergeRequestDiscussion: MergeRequestDiscussion) => {
			return mergeRequestDiscussion.notes.find((discussionNote: DiscussionNote) => (discussionNote.resolvable && !discussionNote.resolved)) !== undefined;
		});

		if (unresolvedDiscussion !== undefined) {
			console.log(`[MR] Merge request has unresolved discussion, assigning back`);

			await Promise.all([
				assignToAuthor(gitlabApi, mergeRequest),
				sendNote(gitlabApi, mergeRequest, `Merge request has unresolved discussion, I can't merge it`),
			]);

			return;
		}

		return mergeRequest;
	});

	(await Promise.all(possibleToAcceptMergeRequests))
		.forEach(async (mergeRequest?: MergeRequest) => {
			if (mergeRequest === undefined) {
				return;
			}

			const jobId = `accept-merge-${mergeRequest.id}`;
			if (worker.hasJobInQueue(mergeRequest.target_project_id, jobId)) {
				return;
			}

			const result = await worker.addJobToQueue(
				mergeRequest.target_project_id,
				jobId,
				() => acceptMergeRequest(gitlabApi, mergeRequest, user, {
					ciInterval: CI_CHECK_INTERVAL,
				}),
			);

			if (result.kind === AcceptMergeRequestResultKind.SuccessfullyMerged) {
				console.log(`[MR] Merge request is merged, ending`);
				return;
			}

			if (result.kind === AcceptMergeRequestResultKind.CanNotBeMerged) {
				await tryCancelPipeline(gitlabApi, result.mergeRequestInfo, user);
				return;
			}

			if (result.kind === AcceptMergeRequestResultKind.ClosedMergeRequest) {
				console.log(`[MR] Merge request is closed, ending`);
				await tryCancelPipeline(gitlabApi, result.mergeRequestInfo, user);
				return;
			}

			if (result.kind === AcceptMergeRequestResultKind.ReassignedMergeRequest) {
				console.log(`[MR] Merge request is assigned to different user, ending`);
				await tryCancelPipeline(gitlabApi, result.mergeRequestInfo, user);
				return;
			}

			if (result.kind === AcceptMergeRequestResultKind.FailedPipeline) {
				console.log(`[MR] pipeline is in failed state: ${result.pipeline.status}, assigning back`);

				await Promise.all([
					assignToAuthor(gitlabApi, mergeRequest),
					sendNote(gitlabApi, mergeRequest, `Merge request can't be merged due to failing pipeline`),
				]);

				return;
			}

			if (result.kind === AcceptMergeRequestResultKind.Unauthorized) {
				console.log(`[MR] You don't have permissions to accept this merge request, assigning back`);

				await Promise.all([
					assignToAuthor(gitlabApi, mergeRequest),
					sendNote(gitlabApi, mergeRequest, `Merge request can't be merged due to insufficient authorization`),
				]);

				return;
			}
		});

	setTimeout(() => runMergeRequestCheckerLoop(user), MR_CHECK_INTERVAL);
};

(async () => {
	const user = await gitlabApi.getMe();
	console.log(`[bot] Hi, I'm ${user.name}. I'll accept merge request assigned to me.`);

	await runMergeRequestCheckerLoop(user);
})();
