import { JobPriority } from '../Queue';
import { Worker } from '../Worker';

it('runs two jobs', async () => {
	const job1 = jest.fn();

	const worker = new Worker();
	const tasks = [];

	expect(worker.findJobPriorityInQueue(1, 'fooJob')).toBe(null);
	expect(worker.findJobPriorityInQueue(2, 'fooJob')).toBe(null);

	tasks.push(worker.addJobToQueue(1, JobPriority.NORMAL, 'fooJob', job1));

	expect(worker.findJobPriorityInQueue(1, 'fooJob')).toBe(JobPriority.NORMAL);
	expect(worker.findJobPriorityInQueue(2, 'fooJob')).toBe(null);

	tasks.push(worker.addJobToQueue(2, JobPriority.NORMAL, 'fooJob', job1));

	expect(worker.findJobPriorityInQueue(1, 'fooJob')).toBe(JobPriority.NORMAL);
	expect(worker.findJobPriorityInQueue(2, 'fooJob')).toBe(JobPriority.NORMAL);

	expect(job1.mock.calls.length).toBe(0);
	await Promise.all(tasks);
	expect(job1.mock.calls.length).toBe(2);
});
