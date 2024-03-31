import { GitlabApi, MergeRequest, User } from './GitlabApi';
import { filterBotLabels } from './MergeRequestAcceptor';

export const assignToAuthorAndResetLabels = async (
	gitlabApi: GitlabApi,
	mergeRequest: MergeRequest,
	currentUser: User,
): Promise<void> => {
	await gitlabApi.updateMergeRequest(mergeRequest.target_project_id, mergeRequest.iid, {
		assignee_id: currentUser.id !== mergeRequest.author.id ? mergeRequest.author.id : 0,
		labels: filterBotLabels(mergeRequest.labels).join(','),
	});
};
