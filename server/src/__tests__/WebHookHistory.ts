import { WebHookHistory } from '../WebHookHistory';

describe('WebHookHistory', () => {
	it('should return values', async () => {
		const webHookHistory = new WebHookHistory<string>(3);
		webHookHistory.add('a');
		webHookHistory.add('b');

		expect(webHookHistory.getHistory()).toStrictEqual(['b', 'a']);
	});

	it('should return last three values', async () => {
		const webHookHistory = new WebHookHistory<string>(3);
		webHookHistory.add('a');
		webHookHistory.add('b');
		webHookHistory.add('c');
		webHookHistory.add('d');

		expect(webHookHistory.getHistory()).toStrictEqual(['d', 'c', 'b']);
	});
});
