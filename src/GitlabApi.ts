import * as fs from 'fs';
import fetch, { RequestInit, Response } from 'node-fetch';
import { Git } from './Git';

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
}

interface MergeRequestUpdateData {
	assignee_id?: number;
	remove_source_branch?: boolean;
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
}

export interface DiscussionNote {
	resolved: boolean;
	resolvable: boolean;
}

export interface MergeRequestDiscussion {
	notes: DiscussionNote[];
}

interface Commit {
	id: string;
}

interface Project {
	id: number;
	ssh_url_to_repo: string;
	path_with_namespace: string;
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
	private readonly repositoryDir: string;

	constructor(gitlabUrl: string, authToken: string, repositoryDir: string) {
		this.gitlabUrl = gitlabUrl;
		this.authToken = authToken;
		this.repositoryDir = repositoryDir;
	}

	public async getMe(): Promise<User> {
		return this.sendRequestWithSingleResponse(`/api/v4/user`, RequestMethod.Get);
	}

	public async getLastCommitOnTarget(projectId: number, branch: string): Promise<Commit> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/repository/commits/${branch}`, RequestMethod.Get);
	}

	public async getAssignedOpenedMergeRequests(): Promise<MergeRequest[]> {
		return this.sendRequestWithMultiResponse(`/api/v4/merge_requests?scope=assigned_to_me&state=opened`, RequestMethod.Get);
	}

	public async getMergeRequestInfo(projectId: number, mergeRequestIid: number): Promise<MergeRequestInfo> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}`, RequestMethod.Get);
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

	public async rebaseMergeRequest(mergeRequest: MergeRequest, user: User): Promise<void> {
		const sourceProject = await this.getProject(mergeRequest.source_project_id);
		const targetProject = await this.getProject(mergeRequest.target_project_id);

		if (!fs.existsSync(this.repositoryDir)) {
			fs.mkdirSync(this.repositoryDir, {
				recursive: true,
			});
		}

		const git = await Git.create(`${this.repositoryDir}/${mergeRequest.target_project_id}`);

		const remoteRepositories = [
			targetProject.path_with_namespace,
		];

		if (targetProject.path_with_namespace !== sourceProject.path_with_namespace) {
			remoteRepositories.push(sourceProject.path_with_namespace);
		}

		remoteRepositories.forEach(async (remoteRepository: string) => {
			try {
				await git.run(`remote add ${remoteRepository} ${this.gitlabUrl}:${this.authToken}@gitlab.com/${remoteRepository}.git`);
			} catch (e) {
				if (e.message.indexOf(`fatal: remote ${remoteRepository} already exists.`) === -1) {
					throw e;
				}
			}
		});

		await git.run(`config user.name "${user.name}"`);
		await git.run(`config user.email "${user.email}"`);

		await git.run(`fetch ${targetProject.path_with_namespace} ${mergeRequest.target_branch}`);
		await git.run(`fetch ${sourceProject.path_with_namespace} ${mergeRequest.source_branch}`);

		await git.run(`checkout ${targetProject.path_with_namespace}/${mergeRequest.target_branch}`);

		try {
			await git.run(`branch -D ${mergeRequest.source_branch}`);
		} catch (e) {
			if (e.message.indexOf(`error: branch '${mergeRequest.source_branch}' not found.`) === -1) {
				throw e;
			}
		}

		await git.run(`checkout -b ${mergeRequest.source_branch} ${sourceProject.path_with_namespace}/${mergeRequest.source_branch}`);
		await git.run(`rebase ${targetProject.path_with_namespace}/${mergeRequest.target_branch} ${mergeRequest.source_branch}`);

		await git.run(`push --force-with-lease ${sourceProject.path_with_namespace} ${mergeRequest.source_branch}:${mergeRequest.source_branch}`);
		await git.run(`checkout ${targetProject.path_with_namespace}/${mergeRequest.target_branch}`);
		await git.run(`branch -D ${mergeRequest.source_branch}`);
	}

	private async getProject(projectId: number): Promise<Project> {
		return this.sendRequestWithSingleResponse(`/api/v4/projects/${projectId}`, RequestMethod.Get);
	}

	private async sendRequestWithSingleResponse(url: string, method: RequestMethod, body?: object): Promise<any> {
		const response = await this.sendRawRequest(url, method, body);

		if (response.status === 401) {
			throw new Error('Unauthorized');
		}

		const data = await response.json();
		if (typeof data !== 'object' && data.id === undefined) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		return data;
	}

	private async sendRequestWithMultiResponse(url: string, method: RequestMethod, body?: object): Promise<any> {
		const response = await this.sendRawRequest(url, method, body);

		if (response.status === 401) {
			throw new Error('Unauthorized');
		}

		const data = await response.json();
		if (!Array.isArray(data)) {
			console.error('response', data);
			throw new Error('Invalid response');
		}

		return data;
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
			options.body = JSON.stringify(body);
		}

		return fetch(`${this.gitlabUrl}${url}`, options);
	}

}
