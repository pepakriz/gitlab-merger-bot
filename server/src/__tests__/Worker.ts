import { QueueId, Worker } from '../Worker';
import { defaultConfig } from '../Config';
import { PubSub } from 'graphql-subscriptions';
import { JobInfo, JobPriority } from '../generated/graphqlgen';

const jobInfoMock: JobInfo = {
	mergeRequest: {
		title: 'title',
		webUrl: 'webUrl',
		projectId: 1,
		authorId: 1,
		iid: 2,
	},
};

const queueInfoMock = {
	projectName: 'test',
};

const config = {
	...defaultConfig,
	GITLAB_AUTH_TOKEN: 'foo',
};

it('runs two jobs', async () => {
	const job1 = jest.fn();
	const job2 = jest.fn();

	const pubSub = new PubSub();
	const worker = new Worker(pubSub, config);

	expect(worker.findJobPriorityInQueue('1' as QueueId, 'fooJob')).toBe(null);
	expect(worker.findJobPriorityInQueue('2' as QueueId, 'fooJob')).toBe(null);

	worker.registerJobToQueue(
		'1' as QueueId,
		queueInfoMock,
		JobPriority.NORMAL,
		'fooJob',
		job1,
		jobInfoMock,
	);

	expect(worker.findJobPriorityInQueue('1' as QueueId, 'fooJob')).toBe(JobPriority.NORMAL);
	expect(worker.findJobPriorityInQueue('2' as QueueId, 'fooJob')).toBe(null);

	worker.registerJobToQueue(
		'2' as QueueId,
		queueInfoMock,
		JobPriority.NORMAL,
		'fooJob',
		job2,
		jobInfoMock,
	);

	expect(worker.findJobPriorityInQueue('1' as QueueId, 'fooJob')).toBe(JobPriority.NORMAL);
	expect(worker.findJobPriorityInQueue('2' as QueueId, 'fooJob')).toBe(JobPriority.NORMAL);

	expect(job1.mock.calls.length).toBe(0);
	expect(job2.mock.calls.length).toBe(0);
});
