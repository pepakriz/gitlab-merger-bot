import fetch, { RequestInit, Response } from 'node-fetch';
import queryString from 'querystring';

export interface User {
	id: number;
	name: string;
	email: string;
}

export enum MergeStatus {
	CanBeMerged = 'can_be_merged',
	Unchecked = 'unchecked',
	Merged = 'merged',
}

export enum MergeState {
	Opened = 'opened',
	Closed = 'closed',
	Locked = 'locked',
	Merged = 'merged',
}

export interface MergeRequest {
	id: number;
	iid: number;
	title: string;
	author: {
		id: number;
	};
	assignee: {
		id: number;
	} | null;
	project_id: number;
	merge_status: MergeStatus;
	web_url: string;
	source_branch: string;
	target_branch: string;
	source_project_id: number;
	target_project_id: number;
	work_in_progress: boolean;
	state: MergeState;
	force_remove_source_branch: boolean;
	labels: string[];
	squash: boolean;
}

interface MergeRequestUpdateData {
	assignee_id?: number;
	remove_source_branch?: boolean;
	squash?: boolean;
	labels?: string;
}

export enum PipelineStatus {
	Running = 'running',
	Pending = 'pending',
	Success = 'success',
	Failed = 'failed',
	Canceled = 'canceled',
	Skipped = 'skipped',
}

export interface MergeRequestPipeline {
	id: number;
	sha: string;
	status: PipelineStatus;
}

export interface MergeRequestInfo extends MergeRequest {
	sha: string;
	diff_refs: {
		start_sha: string,
		base_sha: string,
		head_sha: string,
	};
	pipeline: MergeRequestPipeline | null;
	diverged_commits_count: number;
	rebase_in_progress: boolean;
	merge_error: string | null;
}

export interface DiscussionNote {
	resolved: boolean;
	resolvable: boolean;
}

export interface MergeRequestDiscussion {
	notes: DiscussionNote[];
}

interface Pipeline {
	user: {
		id: number,
	};
}

export enum RequestMethod {
	Get = 'get',
	Put = 'put',
	Post = 'post',
}

export class GitlabApi {

	private readonly gitlabUrl: string;
	private readonly authToken: string;

	constructor(gitlabUrl: string, authToken: string) {
		this.gitlabUrl = gitlabUrl;
		this.authToken = authToken;
	}

	public async getMe(): Promise<User> {
		return this.sendRequestWithSingleResponse(`/api/v4/user`, RequestMethod.Get);
	}

	public async getAssignedOpenedMergeRequests(): Promise<MergeRequest[]> {
		return this.sendRequestWithMultiResponse(`/api/v4/merge_requests?scope=assigned_to_me&state=opened`, RequestMethod.Get);
	}

	public async getMergeRequestInfo(projectId: number, mergeRequestIid: number): Promise<MergeRequestInfo> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`, RequestMethod.Get, {
			include_diverged_commits_count: true,
			include_rebase_in_progress: true,
		});
	}

	public async getMergeRequestDiscussions(projectId: number, mergeRequestIid: number): Promise<MergeRequestDiscussion[]> {
		return this.sendRequestWithMultiResponse(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`, RequestMethod.Get);
	}

	public async updateMergeRequest(projectId: number, mergeRequestIid: number, data: MergeRequestUpdateData): Promise<MergeRequestInfo> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`, RequestMethod.Put, data);
	}

	public async getPipeline(projectId: number, pipelineId: number): Promise<Pipeline> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/pipelines/${pipelineId}`, RequestMethod.Get);
	}

	public async retryPipeline(projectId: number, pipelineId: number): Promise<void> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/pipelines/${pipelineId}/retry`, RequestMethod.Post);
	}

	public async cancelPipeline(projectId: number, pipelineId: number): Promise<void> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/pipelines/${pipelineId}/cancel`, RequestMethod.Post);
	}

	public async createMergeRequestNote(projectId: number, mergeRequestIid: number, body: string): Promise<void> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`, RequestMethod.Post, {
			body,
		});
	}

	public async rebaseMergeRequest(projectId: number, mergeRequestIid: number): Promise<void> {
		const response = await this.sendRawRequest(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/rebase`, RequestMethod.Put);
		this.validateResponseStatus(response);
	}

	private async sendRequestWithSingleResponse(url: string, method: RequestMethod, body?: object): Promise<any> {
		const response = await this.sendRawRequest(url, method, body);
		this.validateResponseStatus(response);

		const data = await response.json();
		if (typeof data !== 'object' && data.id === undefined) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		return data;
	}

	private async sendRequestWithMultiResponse(url: string, method: RequestMethod, body?: object): Promise<any> {
		const response = await this.sendRawRequest(url, method, body);
		this.validateResponseStatus(response);

		const data = await response.json();
		if (!Array.isArray(data)) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		return data;
	}

	private validateResponseStatus(response: Response): void {
		if (response.status === 401) {
			throw new Error('Unauthorized');
		}

		if (response.status === 403) {
			throw new Error('Forbidden');
		}

		if (response.status < 200 || response.status >= 300) {
			throw new Error('Unexpected status code');
		}
	}

	public sendRawRequest(url: string, method: RequestMethod, body?: object): Promise<Response> {
		const options: RequestInit = {
			method,
			headers: {
				'Private-Token': this.authToken,
				'Content-Type': 'application/json',
			},
		};

		if (body !== undefined) {
			if (method === RequestMethod.Get) {
				url = url + '?' + queryString.stringify(body);
			} else {
				options.body = JSON.stringify(body);
			}
		}

		return fetch(`${this.gitlabUrl}${url}`, options);
	}

}
