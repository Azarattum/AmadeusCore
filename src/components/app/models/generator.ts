/**
 * Returns first n items from the given async generator
 * @param generator Generator function of items
 * @param count Number of items
 */
export async function first<T>(
	generator: AsyncGenerator<T>,
	count: number = 1
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

/**
 * Creates an async generator which can be cloned.
 * The return history of the generator is preserved for every instance
 * @param generator Original generator
 */
export function clonable<T>(
	generator: AsyncGenerator<T>
): AsyncClonableGenerator<T> {
	const cache: any[] = [];

	return (function make(n) {
		return {
			next(arg: any) {
				const len = cache.length;
				if (n >= len) cache[len] = generator.next(arg);
				return cache[n++];
			},
			clone() {
				return make(n);
			},
			throw(error: any) {
				return generator.throw(error);
			},
			return(value: any) {
				return generator.return(value);
			},
			[Symbol.asyncIterator]() {
				return this;
			}
		};
	})(0);
}

type AsyncClonableGenerator<T> = AsyncGenerator<T> & {
	clone: () => AsyncClonableGenerator<T>;
};
