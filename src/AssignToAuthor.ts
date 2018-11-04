import { GitlabApi, MergeRequest } from './GitlabApi';

export const assignToAuthor = async (gitlabApi: GitlabApi, mergeRequest: MergeRequest) => {
	await gitlabApi.updateMergeRequest(mergeRequest.project_id, mergeRequest.iid, {
		assignee_id: mergeRequest.author.id,
	});
};
