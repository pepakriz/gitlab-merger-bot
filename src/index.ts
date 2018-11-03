import * as env from 'env-var';
import * as fs from 'fs';
import {
	DiscussionNote,
	GitlabApi,
	MergeRequest,
	MergeRequestDiscussion, MergeRequestInfo,
	MergeState,
	MergeStatus,
	PipelineStatus,
	RequestMethod,
	User,
} from './GitlabApi';
import { Worker } from './Worker';

process.on('unhandledRejection', (error) => {
	console.error('unhandledRejection', error);
	process.exit(1);
});

const GITLAB_URL = env.get('GITLAB_URL', 'https://gitlab.com').asUrlString();
const GITLAB_AUTH_TOKEN = env.get('GITLAB_AUTH_TOKEN').required().asString();
const CI_CHECK_INTERVAL = env.get('CI_CHECK_INTERVAL', '10').asIntPositive() * 1000;
const MR_CHECK_INTERVAL = env.get('MR_CHECK_INTERVAL', '20').asIntPositive() * 1000;
const dataDir = env.get('DATA_DIR', `${__dirname}/../data`).asString();

if (!fs.existsSync(dataDir)) {
	throw new Error(`Data directory ${dataDir} does not exist`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const gitlabApi = new GitlabApi(GITLAB_URL, GITLAB_AUTH_TOKEN, `${dataDir}/repository`);
const worker = new Worker();

const assigneeOriginalAuthor = async (mergeRequest: MergeRequest) => {
	await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
		assignee_id: mergeRequest.author.id,
	});
};

const tryCancelPipeline = async (mergeRequestInfo: MergeRequestInfo, user: User): Promise<void> => {
	if (mergeRequestInfo.pipeline === null) {
		return;
	}

	if (mergeRequestInfo.pipeline.status !== PipelineStatus.Running && mergeRequestInfo.pipeline.status !== PipelineStatus.Pending) {
		return;
	}

	const mergeRequestPipeline = await gitlabApi.getPipeline(mergeRequestInfo.project_id, mergeRequestInfo.pipeline.id);
	if (mergeRequestPipeline.user.id !== user.id) {
		return;
	}

	await gitlabApi.cancelPipeline(mergeRequestInfo.project_id, mergeRequestInfo.pipeline.id);
};

const acceptMergeRequest = async (mergeRequest: MergeRequest, user: User): Promise<void> => {
	let mergeRequestInfo;
	let lastCommitOnTarget;

	while (true) {
		mergeRequestInfo = await gitlabApi.getMergeRequestInfo(mergeRequest.project_id, mergeRequest.iid);

		if (mergeRequestInfo.assignee !== null && mergeRequestInfo.assignee.id !== user.id) {
			console.log(`[MR] Merge request is assigned to different user, ending`);
			await tryCancelPipeline(mergeRequestInfo, user);
			return;
		}

		if (mergeRequestInfo.state === MergeState.Merged) {
			console.log(`[MR] Merge request is merged, ending`);
			return;
		}

		if (mergeRequestInfo.state === MergeState.Closed) {
			console.log(`[MR] Merge request is closed, ending`);
			return;
		}

		if (mergeRequestInfo.state !== MergeState.Opened) {
			throw new Error(`Unexpected MR status: ${mergeRequestInfo.state}`);
		}

		if (mergeRequestInfo.merge_status !== MergeStatus.CanBeMerged || mergeRequestInfo.work_in_progress) {
			await tryCancelPipeline(mergeRequestInfo, user);
			return; // Assign to author will be processed in mergeRequestCheckerLoop
		}

		lastCommitOnTarget = await gitlabApi.getLastCommitOnTarget(mergeRequest.project_id, mergeRequest.target_branch);
		if (mergeRequestInfo.diff_refs.base_sha !== lastCommitOnTarget.id) {
			await tryCancelPipeline(mergeRequestInfo, user);
			await gitlabApi.rebaseMergeRequest(mergeRequest);
			continue;
		}

		if (mergeRequestInfo.pipeline === null) {
			console.log(`[MR] Pipeline doesn't exist, retrying`);
			continue;
		}

		if (mergeRequestInfo.pipeline.sha !== mergeRequestInfo.sha) {
			console.log(`[MR] Unexpected pipeline sha, retrying`);
			continue;
		}

		if (mergeRequestInfo.pipeline.status === PipelineStatus.Running || mergeRequestInfo.pipeline.status === PipelineStatus.Pending) {
			await sleep(CI_CHECK_INTERVAL);
			console.log(`[MR] Waiting for CI. Current status: ${mergeRequestInfo.pipeline.status}`);
			continue;
		}

		if (mergeRequestInfo.pipeline.status === PipelineStatus.Canceled) {
			console.log(`[MR] pipeline is canceled calling retry`);
			await gitlabApi.retryPipeline(mergeRequest.project_id, mergeRequestInfo.pipeline.id);
			continue;
		}

		if (mergeRequestInfo.pipeline.status === PipelineStatus.Failed) {
			console.log(`[MR] pipeline is in failed state: ${mergeRequestInfo.pipeline.status}, assigning back`);
			await assigneeOriginalAuthor(mergeRequest);
			return;
		}

		if (mergeRequestInfo.pipeline.status !== PipelineStatus.Success) {
			throw new Error(`Unexpected pipeline status: ${mergeRequestInfo.pipeline.status}`);
		}

		console.log('[MR] Calling merge request');
		const response = await gitlabApi.sendRawRequest(`/api/v4/projects/${mergeRequest.project_id}/merge_requests/${mergeRequest.iid}/merge`, RequestMethod.Put, {
			should_remove_source_branch: true,
			merge_when_pipeline_succeeds: true,
			sha: mergeRequestInfo.diff_refs.head_sha,
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
			console.log(`[MR] You don't have permissions to accept this merge request, assigning back`);
			await assigneeOriginalAuthor(mergeRequest);
			return;
		}

		if (response.status !== 200) {
			throw new Error(`Unsupported response status ${response.status}`);
		}

		const data = await response.json();
		if (typeof data !== 'object' && data.id === undefined) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		console.log(`[MR] Merge request is processing`);
		await sleep(CI_CHECK_INTERVAL);
	}
};

const runMergeRequestCheckerLoop = async (user: User) => {
	console.log('[bot] Checking assigned merge requests');
	const mergeRequests = await gitlabApi.getAssignedOpenedMergeRequests();

	const newMergeRequestQueue = mergeRequests.map(async (mergeRequest: MergeRequest) => {
		if (mergeRequest.merge_status !== MergeStatus.CanBeMerged) {
			console.log(`[MR] Branch cannot be merged. Maybe conflict or unresolved discussions, assigning back`);
			await assigneeOriginalAuthor(mergeRequest);
			return;
		}

		if (mergeRequest.work_in_progress) {
			console.log(`[MR] Merge request is WIP, assigning back`);
			await assigneeOriginalAuthor(mergeRequest);
			return;
		}

		const mergeRequestDiscussions = await gitlabApi.getMergeRequestDiscussions(mergeRequest.project_id, mergeRequest.iid);
		const unresolvedDiscussion = mergeRequestDiscussions.find((mergeRequestDiscussion: MergeRequestDiscussion) => {
			return mergeRequestDiscussion.notes.find((discussionNote: DiscussionNote) => (discussionNote.resolvable && !discussionNote.resolved)) !== undefined;
		});

		if (unresolvedDiscussion !== undefined) {
			console.log(`[MR] Merge request has unresolved discussion, assigning back`);
			await assigneeOriginalAuthor(mergeRequest);
			return;
		}

		return mergeRequest;
	});

	(await Promise.all(newMergeRequestQueue))
		.forEach((mergeRequest?: MergeRequest) => {
			if (mergeRequest === undefined) {
				return;
			}

			worker.addJobToQueue(
				mergeRequest.target_project_id,
				`accept-merge-${mergeRequest.id}`,
				() => acceptMergeRequest(mergeRequest, user),
			);
		});

	setTimeout(() => runMergeRequestCheckerLoop(user), MR_CHECK_INTERVAL);
};

(async () => {
	const user = await gitlabApi.getMe();
	console.log(`[bot] Hi, I'm ${user.name}. I'll accept merge request assigned to me.`);

	await runMergeRequestCheckerLoop(user);
})();
