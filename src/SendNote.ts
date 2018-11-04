import { GitlabApi, MergeRequest } from './GitlabApi';

export const sendNote = (gitlabApi: GitlabApi, mergeRequest: MergeRequest, body: string): Promise<void> =>
	gitlabApi.createMergeRequestNote(mergeRequest.project_id, mergeRequest.iid, body);
