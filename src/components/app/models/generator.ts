/**
 * Returns first n items from the given async generator
 * @param generator Generator function of items
 * @param count Number of items
 */
export async function first<T>(
	generator: AsyncGenerator<T>,
	count: number
): Promise<T[]> {
	const promises = [];
	for (let i = 0; i < count; i++) {
		promises.push(generator.next());
	}

	const resolved = await Promise.all(promises);
	return resolved.filter(x => !x.done).map(x => x.value);
}

/**
 * Merges an array of async generators into a single one
 * @param generators Generators to merge
 */
export async function* mergeGenerators<T>(
	generators: AsyncGenerator<T>[]
): AsyncGenerator<T> {
	let available;
	do {
		available = 0;
		for (const generator of generators) {
			const item = await generator.next();
			if (item.done) continue;
			yield item.value;
			available++;
		}
	} while (available);
}

/**
 * Creates an async generator from any item or an array of items
 * @param from Source item or array
 */
export function generate<T>(from: T | T[]): AsyncGenerator<T> {
	return (async function*() {
		if (Array.isArray(from)) {
			for (const item of from) {
				yield item;
			}
		} else {
			yield from;
		}
	})();
}
