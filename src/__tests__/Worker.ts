import { JobPriority } from '../Queue';
import { Worker } from '../Worker';

it('runs two jobs', async () => {
	const job1 = jest.fn();

	const worker = new Worker();
	const tasks = [];

	expect(worker.hasJobInQueue(1, 'fooJob', JobPriority.NORMAL)).toBe(false);
	expect(worker.hasJobInQueue(2, 'fooJob', JobPriority.NORMAL)).toBe(false);

	tasks.push(worker.addJobToQueue(1, JobPriority.NORMAL, 'fooJob', job1));

	expect(worker.hasJobInQueue(1, 'fooJob', JobPriority.NORMAL)).toBe(true);
	expect(worker.hasJobInQueue(2, 'fooJob', JobPriority.NORMAL)).toBe(false);

	tasks.push(worker.addJobToQueue(2, JobPriority.NORMAL, 'fooJob', job1));

	expect(worker.hasJobInQueue(1, 'fooJob', JobPriority.NORMAL)).toBe(true);
	expect(worker.hasJobInQueue(2, 'fooJob', JobPriority.NORMAL)).toBe(true);

	expect(job1.mock.calls.length).toBe(0);
	await Promise.all(tasks);
	expect(job1.mock.calls.length).toBe(2);
});
