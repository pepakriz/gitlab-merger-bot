import { GitlabApi, MergeRequestInfo, PipelineStatus, User } from './GitlabApi';

export const tryCancelPipeline = async (
	gitlabApi: GitlabApi,
	mergeRequestInfo: MergeRequestInfo,
	user: User,
): Promise<void> => {
	if (mergeRequestInfo.head_pipeline === null) {
		return;
	}

	if (
		mergeRequestInfo.head_pipeline.status !== PipelineStatus.Running &&
		mergeRequestInfo.head_pipeline.status !== PipelineStatus.Pending
	) {
		return;
	}

	const mergeRequestPipeline = await gitlabApi.getPipeline(
		mergeRequestInfo.project_id,
		mergeRequestInfo.head_pipeline.id,
	);
	if (mergeRequestPipeline.user.id !== user.id) {
		return;
	}

	await gitlabApi.cancelPipeline(mergeRequestInfo.project_id, mergeRequestInfo.head_pipeline.id);
};
