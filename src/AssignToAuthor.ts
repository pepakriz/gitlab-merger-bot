import { GitlabApi, MergeRequest, User } from './GitlabApi';
import { filterBotLabels } from './MergeRequestAcceptor';

export const assignToAuthorAndResetLabels = async (gitlabApi: GitlabApi, mergeRequest: MergeRequest, currentUser: User) => {
	await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
		assignee_id: currentUser.id !== mergeRequest.author.id ? mergeRequest.author.id : 0,
		labels: filterBotLabels(mergeRequest.labels).join(','),
	});
};
