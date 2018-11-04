import { Queue } from '../Queue';

it('runs two jobs', async () => {
	const job = jest.fn();

	const queue = new Queue();
	queue.runJob('fooJob', job);
	const task = queue.runJob('barJob', job);

	expect(job.mock.calls.length).toBe(0);
	await task;
	expect(job.mock.calls.length).toBe(2);
});

it('runs again after done', async () => {
	const job = jest.fn();

	const queue = new Queue();
	await queue.runJob('fooJob', job);

	expect(job.mock.calls.length).toBe(1);
	await queue.runJob('barJob', job);
	expect(job.mock.calls.length).toBe(2);
});
