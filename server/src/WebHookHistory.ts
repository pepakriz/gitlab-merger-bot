export class WebHookHistory<TItem> {
	private isHistoryFull = false;
	private historyIndex = 0;
	private readonly history: TItem[] = [];

	public constructor(historyLength: number) {
		this.history.length = historyLength;
	}

	public add(item: TItem) {
		this.history[this.historyIndex] = item;
		this.increaseIndex();
	}

	public getHistory(): TItem[] {
		if (!this.isHistoryFull) {
			return this.history.slice(0, this.historyIndex).reverse();
		}

		return [
			...this.history.slice(this.historyIndex),
			...this.history.slice(0, this.historyIndex),
		].reverse();
	}

	private increaseIndex() {
		this.historyIndex = this.historyIndex + 1;
		if (this.historyIndex >= this.history.length) {
			this.historyIndex = 0;
			this.isHistoryFull = true;
		}
	}
}
