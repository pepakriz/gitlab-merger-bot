import { JobPriority, Queue } from '../Queue';
import { sleep } from '../Utils';

it('runs two jobs', async () => {
	const job = jest.fn();

	const queue = new Queue();
	queue.runJob('fooJob', job, JobPriority.NORMAL);
	const task = queue.runJob('barJob', job, JobPriority.NORMAL);

	expect(job.mock.calls.length).toBe(0);
	await task;
	expect(job.mock.calls.length).toBe(2);
});

it('runs again after done', async () => {
	const job = jest.fn();

	const queue = new Queue();
	await queue.runJob('fooJob', job, JobPriority.NORMAL);

	expect(job.mock.calls.length).toBe(1);
	await queue.runJob('barJob', job, JobPriority.NORMAL);
	expect(job.mock.calls.length).toBe(2);
	await queue.runJob('barJob', job, JobPriority.NORMAL);
	expect(job.mock.calls.length).toBe(3);
});

it('hasJob while processing', async () => {
	const queue = new Queue();
	queue.runJob('fooJob', () => sleep(20), JobPriority.NORMAL);
	await sleep(10);

	expect(queue.hasJob('fooJob', JobPriority.NORMAL)).toBe(true);
});
