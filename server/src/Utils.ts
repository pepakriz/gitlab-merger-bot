import { MergeRequest } from './GitlabApi';
import { QueueId } from './Worker';

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export const formatQueueId = (
	mergeRequest: Pick<MergeRequest, 'target_branch' | 'target_project_id'>,
) => `${mergeRequest.target_project_id}:${mergeRequest.target_branch}` as QueueId;
