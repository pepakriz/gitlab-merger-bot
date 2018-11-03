import { Worker } from '../Worker';

it('runs two jobs', async () => {
	const job1 = jest.fn();

	const worker = new Worker();
	const tasks = [];
	tasks.push(worker.addJobToQueue(1, 'fooJob', job1));
	tasks.push(worker.addJobToQueue(1, 'fooJob', job1));
	tasks.push(worker.addJobToQueue(2, 'fooJob', job1));
	tasks.push(worker.addJobToQueue(2, 'fooJob', job1));

	expect(job1.mock.calls.length).toBe(0);
	await Promise.all(tasks);
	expect(job1.mock.calls.length).toBe(2);
});
