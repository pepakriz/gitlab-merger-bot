import { Queue } from '../Queue';
import { defaultConfig } from '../Config';
import { JobInfo, JobPriority, QueueInfo } from '../generated/graphqlgen';

const jobInfoMock: JobInfo = {
	mergeRequest: {
		title: 'title',
		webUrl: 'webUrl',
		projectId: 1,
		authorId: 1,
		iid: 2,
	},
};

const queueInfoMock: QueueInfo = {
	projectName: 'test',
};

const onChange = jest.fn();

it('runs two jobs', async () => {
	const job1 = jest.fn(({ success }) => {
		success();
	});
	const job2 = jest.fn();
	const job3 = jest.fn();

	const queue = new Queue(defaultConfig, queueInfoMock, onChange);

	queue.registerJob('job1', job1, JobPriority.NORMAL, jobInfoMock);
	queue.registerJob('job2', job2, JobPriority.NORMAL, jobInfoMock);
	queue.registerJob('job3', job3, JobPriority.NORMAL, jobInfoMock);

	expect(job1.mock.calls.length).toBe(0);
	expect(job2.mock.calls.length).toBe(0);
	expect(job3.mock.calls.length).toBe(0);
	await queue.tick();
	expect(job1.mock.calls.length).toBe(1);
	expect(job2.mock.calls.length).toBe(1);
	expect(job3.mock.calls.length).toBe(0);
	await queue.tick();
	expect(job1.mock.calls.length).toBe(1);
	expect(job2.mock.calls.length).toBe(2);
	expect(job3.mock.calls.length).toBe(0);
	await queue.tick();
	expect(job1.mock.calls.length).toBe(1);
	expect(job2.mock.calls.length).toBe(3);
	expect(job3.mock.calls.length).toBe(0);
});
