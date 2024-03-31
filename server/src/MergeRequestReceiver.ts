import { DetailedMergeStatus, GitlabApi, MergeRequest, MergeState, ToDo, User } from './GitlabApi';
import { assignToAuthorAndResetLabels } from './AssignToAuthor';
import { sendNote } from './SendNote';
import {
	acceptMergeRequest,
	AcceptMergeRequestResultKind,
	BotLabels,
	containsAssignedUser,
	runAcceptingMergeRequest,
} from './MergeRequestAcceptor';
import { resolveMergeRequestResult } from './MergeRequestResultResolver';
import { setBotLabels } from './BotLabelsSetter';
import { Worker } from './Worker';
import { Config } from './Config';
import { JobInfo, JobPriority } from './generated/graphqlgen';

export const prepareMergeRequestForMerge = async (
	gitlabApi: GitlabApi,
	user: User,
	worker: Worker,
	config: Config,
	mergeRequestData:
		| {
				mergeRequestTodo: ToDo;
		  }
		| {
				mergeRequest: MergeRequest;
		  },
) => {
	const { mergeRequest, author } = (() => {
		if ('mergeRequestTodo' in mergeRequestData) {
			return {
				mergeRequest: mergeRequestData.mergeRequestTodo.target,
				author: mergeRequestData.mergeRequestTodo.author,
			};
		}

		return {
			mergeRequest: mergeRequestData.mergeRequest,
			author: null,
		};
	})();

	const jobId = `accept-merge-${mergeRequest.id}`;
	const jobPriority = mergeRequest.labels.includes(config.HIGH_PRIORITY_LABEL)
		? JobPriority.HIGH
		: JobPriority.NORMAL;
	const jobInfo: JobInfo = {
		mergeRequest: {
			iid: mergeRequest.iid,
			projectId: mergeRequest.target_project_id,
			authorId: mergeRequest.author.id,
			title: mergeRequest.title,
			webUrl: mergeRequest.web_url,
		},
	};

	const currentJob = worker.findJob(mergeRequest.project_id, jobId);
	if (currentJob !== null) {
		currentJob.updateInfo(jobInfo);
	}

	const currentJobPriority = worker.findJobPriorityInQueue(mergeRequest.project_id, jobId);
	if (currentJobPriority === jobPriority) {
		return;
	}

	if (currentJobPriority !== null) {
		console.log(`[loop][MR][${mergeRequest.iid}] Changing job priority to ${jobPriority}.`);
		await worker.setJobPriority(mergeRequest.target_project_id, jobId, jobPriority);
		return;
	}

	if (!containsAssignedUser(mergeRequest, user)) {
		if ('mergeRequestTodo' in mergeRequestData) {
			await gitlabApi.markTodoAsDone(mergeRequestData.mergeRequestTodo.id);
		}

		return;
	}

	if (mergeRequest.state === MergeState.Merged) {
		await setBotLabels(gitlabApi, mergeRequest, []);
		return;
	}

	if (mergeRequest.state !== MergeState.Opened) {
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
			setBotLabels(gitlabApi, mergeRequest, []),
		]);

		return;
	}

	if (
		config.ALLOWED_PROJECT_IDS.length > 0 &&
		!config.ALLOWED_PROJECT_IDS.includes(mergeRequest.target_project_id.toString())
	) {
		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
			sendNote(
				gitlabApi,
				mergeRequest,
				`I can't merge it because I'm not allowed to operate on this project.`,
			),
		]);
	}

	// Validate permissions
	if (author !== null) {
		const protectedBranch = await gitlabApi.getProtectedBranch(
			mergeRequest.target_project_id,
			mergeRequest.target_branch,
		);
		if (protectedBranch !== null) {
			const member = await gitlabApi.getMember(mergeRequest.target_project_id, author.id);
			if (member === null) {
				await Promise.all([
					assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
					sendNote(
						gitlabApi,
						mergeRequest,
						`I can't merge it because the merge request was made by ${author.username} who is unauthorized for this instruction.`,
					),
				]);

				return;
			}

			const hasAccessLevel = protectedBranch.merge_access_levels.find((mergeAccessLevel) => {
				if (mergeAccessLevel.user_id !== null && member.id === mergeAccessLevel.user_id) {
					return true;
				}

				if (
					mergeAccessLevel.access_level !== null &&
					member.access_level >= mergeAccessLevel.access_level
				) {
					return true;
				}

				return false;
			});
			if (!hasAccessLevel) {
				await Promise.all([
					assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
					sendNote(
						gitlabApi,
						mergeRequest,
						`I can't merge it because the merge request was made by ${author.username} who doesn't pass the protection of the target branch.`,
					),
				]);

				return;
			}
		}
	}

	if (mergeRequest.detailed_merge_status === DetailedMergeStatus.DraftStatus) {
		console.log(`[loop][MR][${mergeRequest.iid}] Merge request is a draft, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
			sendNote(
				gitlabApi,
				mergeRequest,
				`Merge request is marked as a draft, I can't merge it`,
			),
		]);

		return;
	}

	if (mergeRequest.detailed_merge_status === DetailedMergeStatus.DiscussionsNotResolved) {
		console.log(
			`[loop][MR][${mergeRequest.iid}] Merge request has unresolved discussion, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
			sendNote(
				gitlabApi,
				mergeRequest,
				`Merge request has unresolved discussion, I can't merge it`,
			),
		]);

		return;
	}

	if (mergeRequest.detailed_merge_status === DetailedMergeStatus.Conflict) {
		console.log(`[loop][MR][${mergeRequest.iid}] MR has conflict`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
			sendNote(gitlabApi, mergeRequest, "Merge request can't be merged: MR has conflict"),
		]);

		return;
	}

	const approvals = await gitlabApi.getMergeRequestApprovals(
		mergeRequest.project_id,
		mergeRequest.iid,
	);
	if (approvals.approvals_left > 0) {
		console.log(
			`[loop][MR][${mergeRequest.iid}] Merge request is waiting for approvals, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequest, user),
			sendNote(
				gitlabApi,
				mergeRequest,
				`Merge request is waiting for approvals. Required ${approvals.approvals_required}, but ${approvals.approvals_left} left.`,
			),
		]);

		return;
	}

	if (jobPriority === JobPriority.HIGH) {
		const mergeResponse = await acceptMergeRequest(
			gitlabApi,
			mergeRequest.target_project_id,
			mergeRequest.iid,
			user,
			config,
		);
		if (mergeResponse.kind === AcceptMergeRequestResultKind.SuccessfullyMerged) {
			console.log(`[loop][MR][${mergeRequest.iid}] High-priority merge request is merged`);
			return;
		}
		console.log(
			`[loop][MR][${mergeRequest.iid}] High-priority merge request is not acceptable in this moment.`,
		);
	}

	console.log(
		`[loop][MR][${mergeRequest.iid}] Adding job to the queue with ${jobPriority} priority.`,
	);
	worker.registerJobToQueue(
		mergeRequest.target_project_id,
		{
			projectName: mergeRequest.references.full.split('!')[0],
		},
		jobPriority,
		jobId,
		async ({ success, job }) => {
			const result = await runAcceptingMergeRequest(
				job,
				gitlabApi,
				mergeRequest.target_project_id,
				mergeRequest.iid,
				user,
				config,
			);
			if (result === undefined) {
				return;
			}

			console.log(`Finishing job: ${JSON.stringify(result)}`);
			if ('mergeRequestTodo' in mergeRequestData) {
				await gitlabApi.markTodoAsDone(mergeRequestData.mergeRequestTodo.id);
			}
			success();
			await resolveMergeRequestResult(gitlabApi, result);
		},
		jobInfo,
	);

	await setBotLabels(gitlabApi, mergeRequest, [BotLabels.InMergeQueue]);
};
