import { assignToAuthorAndResetLabels } from './AssignToAuthor';
import { setBotLabels } from './BotLabelsSetter';
import { GitlabApi } from './GitlabApi';
import { AcceptMergeRequestResult, AcceptMergeRequestResultKind } from './MergeRequestAcceptor';
import { tryCancelPipeline } from './PipelineCanceller';
import { sendNote } from './SendNote';

export const resolveMergeRequestResult = async (
	gitlabApi: GitlabApi,
	result: AcceptMergeRequestResult,
) => {
	const mergeRequestInfo = result.mergeRequestInfo;
	const user = result.user;

	if (result.kind === AcceptMergeRequestResultKind.SuccessfullyMerged) {
		console.log(`[MR][${mergeRequestInfo.iid}] Merge request is merged, ending`);
		await setBotLabels(gitlabApi, mergeRequestInfo, []);
		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.WorkInProgress) {
		const message = "Merge request can't be merged: MR is marked as WIP";
		console.log(`[MR][${mergeRequestInfo.iid}] merge failed: ${message}, assigning back`);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.CanNotBeMerged) {
		let message = "Merge request can't be merged";
		const errorMessage = mergeRequestInfo.merge_error;
		if (errorMessage !== null) {
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
			sendNote(gitlabApi, mergeRequestInfo, "Merge request can't be merged: MR has conflict"),
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
		console.log(
			`[MR][${mergeRequestInfo.iid}] Merge request is assigned to different user, ending`,
		);

		await Promise.all([
			tryCancelPipeline(gitlabApi, mergeRequestInfo, user),
			setBotLabels(gitlabApi, mergeRequestInfo, []),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.FailedPipeline) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] pipeline is in failed state: ${result.pipeline.status}, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(
				gitlabApi,
				mergeRequestInfo,
				`Merge request can't be merged due to failing pipeline`,
			),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.WaitingPipeline) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] pipeline is waiting for a manual action: ${result.pipeline.status}, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(
				gitlabApi,
				mergeRequestInfo,
				`Merge request can't be merged. Pipeline is waiting for a manual user action.`,
			),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.WaitingForApprovals) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] Merge request is waiting for approvals, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(
				gitlabApi,
				mergeRequestInfo,
				`Merge request is waiting for approvals. Required ${result.approvals.approvals_required}, but ${result.approvals.approvals_left} left.`,
			),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.UnresolvedDiscussion) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] Merge request has unresolved discussion, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(
				gitlabApi,
				mergeRequestInfo,
				`Merge request has unresolved discussion, I can't merge it`,
			),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.InvalidPipeline) {
		const message =
			result.pipeline === null
				? `Merge request can't be merged. Pipeline does not exist`
				: `Merge request can't be merged. The latest pipeline is not executed on the latest commit`;

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(gitlabApi, mergeRequestInfo, message),
		]);

		return;
	}

	if (result.kind === AcceptMergeRequestResultKind.Unauthorized) {
		console.log(
			`[MR][${mergeRequestInfo.iid}] You don't have permissions to accept this merge request, assigning back`,
		);

		await Promise.all([
			assignToAuthorAndResetLabels(gitlabApi, mergeRequestInfo, user),
			sendNote(
				gitlabApi,
				mergeRequestInfo,
				`Merge request can't be merged due to insufficient authorization`,
			),
		]);

		return;
	}
};
