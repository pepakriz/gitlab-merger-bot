import { GitlabApi, MergeRequestInfo, PipelineStatus, User } from './GitlabApi';

export const tryCancelPipeline = async (
	gitlabApi: GitlabApi,
	mergeRequestInfo: MergeRequestInfo,
	user: User,
): Promise<void> => {
	if (mergeRequestInfo.pipeline === null) {
		return;
	}

	if (
		mergeRequestInfo.pipeline.status !== PipelineStatus.Running &&
		mergeRequestInfo.pipeline.status !== PipelineStatus.Pending
	) {
		return;
	}

	const mergeRequestPipeline = await gitlabApi.getPipeline(
		mergeRequestInfo.project_id,
		mergeRequestInfo.pipeline.id,
	);
	if (mergeRequestPipeline.user.id !== user.id) {
		return;
	}

	await gitlabApi.cancelPipeline(mergeRequestInfo.project_id, mergeRequestInfo.pipeline.id);
};
