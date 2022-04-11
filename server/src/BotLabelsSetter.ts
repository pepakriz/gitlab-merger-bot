import { GitlabApi, MergeRequest } from './GitlabApi';
import { BotLabels, filterBotLabels } from './MergeRequestAcceptor';

export const setBotLabels = async (
	gitlabApi: GitlabApi,
	mergeRequest: MergeRequest,
	labels: BotLabels[],
) => {
	await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
		labels: [...filterBotLabels(mergeRequest.labels), ...labels].join(','),
	});
};
