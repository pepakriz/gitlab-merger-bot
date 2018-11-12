import { GitlabApi, MergeRequest } from './GitlabApi';
import { filterBotLabels } from './MergeRequestAcceptor';

export const assignToAuthorAndResetLabels = async (gitlabApi: GitlabApi, mergeRequest: MergeRequest) => {
	await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
		assignee_id: mergeRequest.author.id,
		labels: filterBotLabels(mergeRequest.labels).join(','),
	});
};
