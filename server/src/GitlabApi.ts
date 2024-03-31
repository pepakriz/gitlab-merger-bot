import fetch, { FetchError, RequestInit, Response } from 'node-fetch';
import queryString, { ParsedUrlQueryInput } from 'querystring';
import { sleep } from './Utils';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as console from 'console';

export interface User {
	id: number;
	name: string;
	username: string;
	email: string;
	avatar_url: string;
	web_url: string;
}

export enum DetailedMergeStatus {
	BlockedStatus = 'blocked_status',
	Checking = 'checking',
	Unchecked = 'unchecked',
	CiMustPass = 'ci_must_pass',
	CiStillRunning = 'ci_still_running',
	DiscussionsNotResolved = 'discussions_not_resolved',
	DraftStatus = 'draft_status',
	ExternalStatusChecks = 'external_status_checks',
	Mergeable = 'mergeable',
	NotApproved = 'not_approved',
	NotOpen = 'not_open',
	JiraAssociationMissing = 'jira_association_missing',
	NeedsRebase = 'needs_rebase',
	Conflict = 'conflict',
	RequestedChanges = 'requested_changes',
}

export enum MergeState {
	Opened = 'opened',
	Closed = 'closed',
	Locked = 'locked',
	Merged = 'merged',
}

interface MergeRequestAssignee {
	id: number;
}

export interface ProtectedBranch {
	id: number;
	name: string;
	merge_access_levels: (
		| {
				access_level: number;
				user_id: null;
				group_id: null;
		  }
		| {
				access_level: null;
				user_id: number;
				group_id: null;
		  }
		| {
				access_level: null;
				user_id: null;
				group_id: number;
		  }
	)[];
}

interface Author {
	id: number;
	username: string;
	name: string;
	web_url: string;
	state: 'active' | 'awaiting';
}

export interface Member extends Author {
	access_level: number;
	expires_at: string | null;
}

export interface ToDo {
	id: number;
	project: {
		id: number;
	};
	author: Author;
	target: MergeRequest;
}

export interface MergeRequest {
	id: number;
	iid: number;
	title: string;
	author: Author;
	assignee: MergeRequestAssignee | null;
	assignees: MergeRequestAssignee[];
	detailed_merge_status: DetailedMergeStatus;
	web_url: string;
	source_branch: string;
	target_branch: string;
	source_project_id: number;
	target_project_id: number;
	state: MergeState;
	force_remove_source_branch: boolean;
	labels: string[];
	squash: boolean;
	has_conflicts: boolean;
	references: {
		full: string;
	};
}

interface MergeRequestUpdateData extends ParsedUrlQueryInput {
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
	Created = 'created',
	WaitingForResource = 'waiting_for_resource',
	Preparing = 'preparing',
	Manual = 'manual',
	Scheduled = 'scheduled',
}

export interface MergeRequestPipeline {
	id: number;
	sha: string;
	status: PipelineStatus;
}

export enum PipelineJobStatus {
	Manual = 'manual',
	Failed = 'failed',
	Canceled = 'canceled',
	Pending = 'pending',
	Started = 'started',
	Running = 'running',
}

export interface PipelineJob {
	id: number;
	name: string;
	allow_failure: boolean;
	status: PipelineJobStatus;
	created_at: string;
}

export interface MergeRequestInfo extends MergeRequest {
	sha: string;
	diff_refs: {
		start_sha: string;
		base_sha: string;
		head_sha: string;
	};
	head_pipeline: MergeRequestPipeline | null;
	diverged_commits_count: number;
	rebase_in_progress: boolean;
	merge_error: string | null;
}

export interface MergeRequestApprovals {
	approvals_required: number;
	approvals_left: number;
}

interface Pipeline {
	user: {
		id: number;
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
	private readonly httpProxy: HttpsProxyAgent<string> | undefined;

	constructor(gitlabUrl: string, authToken: string, httpProxy: string | undefined) {
		this.gitlabUrl = gitlabUrl;
		this.authToken = authToken;
		this.httpProxy = httpProxy ? new HttpsProxyAgent(httpProxy) : undefined;
	}

	public async getMe(): Promise<User> {
		return this.sendRequestWithSingleResponse(`/api/v4/user`, RequestMethod.Get);
	}

	public async getUser(userId: number): Promise<User> {
		return this.sendRequestWithSingleResponse(`/api/v4/users/${userId}`, RequestMethod.Get);
	}

	public async getProtectedBranch(
		projectId: number,
		name: string,
	): Promise<ProtectedBranch | null> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/protected_branches/${encodeURIComponent(name)}`,
			RequestMethod.Get,
		);
	}

	public async getMember(projectId: number, userId: number): Promise<Member | null> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/members/all/${userId}`,
			RequestMethod.Get,
		);
	}

	public async getMergeRequestTodos(): Promise<ToDo[]> {
		return this.sendRequestWithMultiResponse(
			`/api/v4/todos?type=MergeRequest&action=assigned&state=pending`,
			RequestMethod.Get,
		);
	}

	public async markTodoAsDone(todoId: number): Promise<void> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/todos/${todoId}/mark_as_done`,
			RequestMethod.Post,
		);
	}

	public async getAssignedOpenedMergeRequests(): Promise<MergeRequest[]> {
		return this.sendRequestWithMultiResponse(
			`/api/v4/merge_requests?scope=assigned_to_me&state=opened`,
			RequestMethod.Get,
		);
	}

	public async getMergeRequest(
		projectId: number,
		mergeRequestIid: number,
	): Promise<MergeRequest> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`,
			RequestMethod.Get,
		);
	}

	public async getMergeRequestInfo(
		projectId: number,
		mergeRequestIid: number,
	): Promise<MergeRequestInfo> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`,
			RequestMethod.Get,
			{
				include_diverged_commits_count: true,
				include_rebase_in_progress: true,
			},
		);
	}

	public async getPipelineJobs(projectId: number, pipelineId: number): Promise<PipelineJob[]> {
		return this.sendRequestWithMultiResponse(
			`/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100`,
			RequestMethod.Get,
		);
	}

	public async getMergeRequestApprovals(
		projectId: number,
		mergeRequestIid: number,
	): Promise<MergeRequestApprovals> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/approvals`,
			RequestMethod.Get,
		);
	}

	public async updateMergeRequest(
		projectId: number,
		mergeRequestIid: number,
		data: MergeRequestUpdateData,
	): Promise<MergeRequestInfo> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`,
			RequestMethod.Put,
			data,
		);
	}

	public async getPipeline(projectId: number, pipelineId: number): Promise<Pipeline> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/pipelines/${pipelineId}`,
			RequestMethod.Get,
		);
	}

	public async cancelPipeline(projectId: number, pipelineId: number): Promise<void> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/pipelines/${pipelineId}/cancel`,
			RequestMethod.Post,
		);
	}

	public async createMergeRequestNote(
		projectId: number,
		mergeRequestIid: number,
		body: string,
	): Promise<void> {
		return this.sendRequestWithSingleResponse(
			`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`,
			RequestMethod.Post,
			{
				body,
			},
		);
	}

	public async rebaseMergeRequest(projectId: number, mergeRequestIid: number): Promise<void> {
		const response = await this.sendRawRequest(
			`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/rebase`,
			RequestMethod.Put,
		);
		await this.validateResponseStatus(response);
	}

	public async retryJob(projectId: number, jobId: number): Promise<void> {
		const response = await this.sendRawRequest(
			`/api/v4/projects/${projectId}/jobs/${jobId}/retry`,
			RequestMethod.Post,
		);
		await this.validateResponseStatus(response);
	}

	public async runJob(projectId: number, jobId: number): Promise<void> {
		const response = await this.sendRawRequest(
			`/api/v4/projects/${projectId}/jobs/${jobId}/play`,
			RequestMethod.Post,
		);
		await this.validateResponseStatus(response);
	}

	private async sendRequestWithSingleResponse(
		url: string,
		method: RequestMethod,
		body?: ParsedUrlQueryInput,
	): Promise<any> {
		const response = await this.sendRawRequest(url, method, body);
		if (response.status === 404) {
			return null;
		}

		await this.validateResponseStatus(response);

		const data = await response.json();
		if (typeof data !== 'object' || data === null || !('id' in data) || data.id === undefined) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		return data;
	}

	private async sendRequestWithMultiResponse(
		url: string,
		method: RequestMethod,
		body?: ParsedUrlQueryInput,
	): Promise<any> {
		const response = await this.sendRawRequest(url, method, body);
		await this.validateResponseStatus(response);

		const data = await response.json();
		if (!Array.isArray(data)) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		return data;
	}

	private async validateResponseStatus(response: Response): Promise<void> {
		if (response.status === 401) {
			throw new Error('Unauthorized');
		}

		if (response.status === 403) {
			throw new Error('Forbidden');
		}

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Unexpected status code: ${response.status} ${await response.json()}`);
		}
	}

	public async sendRawRequest(
		url: string,
		method: RequestMethod,
		body?: ParsedUrlQueryInput,
	): Promise<Response> {
		const options: RequestInit = {
			method,
			timeout: 10000,
			headers: {
				'Private-Token': this.authToken,
				'Content-Type': 'application/json',
			},
			agent: this.httpProxy,
		};

		if (body !== undefined) {
			if (method === RequestMethod.Get) {
				url = url + '?' + queryString.stringify(body);
			} else {
				options.body = JSON.stringify(body);
			}
		}

		const requestUrl = `${this.gitlabUrl}${url}`;

		const numberOfRequestRetries = 20;
		let retryCounter = 0;
		while (true) {
			retryCounter++;

			try {
				const response = await fetch(requestUrl, options);
				if (response.status >= 500) {
					if (retryCounter >= numberOfRequestRetries) {
						throw new Error(
							`Unexpected status code ${response.status} after ${numberOfRequestRetries} retries`,
						);
					}

					const sleepTimeout = 10000;
					console.log(
						`GitLab request ${method.toUpperCase()} ${requestUrl} responded with a status ${
							response.status
						}, I'll try it again after ${sleepTimeout}ms`,
					);
					await sleep(sleepTimeout);
					continue;
				}

				return response;
			} catch (e) {
				if (
					retryCounter < numberOfRequestRetries &&
					e instanceof FetchError &&
					['system', 'request-timeout'].includes(e.type) // `getaddrinfo EAI_AGAIN` errors etc. see https://github.com/bitinn/node-fetch/blob/master/src/index.js#L108
				) {
					const sleepTimeout = 10000;
					console.log(
						`GitLab request ${method.toUpperCase()} ${requestUrl} failed: ${
							e.message
						}, I'll try it again after ${sleepTimeout}ms`,
					);
					await sleep(sleepTimeout);
					continue;
				}

				throw e;
			}
		}
	}
}
