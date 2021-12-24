import { shuffle } from "../../common/utils.class";

/**
 * Returns first n items from the given async generator
 * @param generator Generator function of items
 * @param count Number of items
 */
export async function first<T>(
  generator: AsyncGenerator<T>
): Promise<T | undefined>;
export async function first<T>(
  generator: AsyncGenerator<T>,
  count: number
): Promise<T[]>;

export async function first<T>(
  generator: AsyncGenerator<T>,
  count?: number
): Promise<T[] | T> {
  const promises = [];
  for (let i = 0; i < (count || 1); i++) {
    promises.push(generator.next());
  }

  const resolved = await Promise.all(promises);

  if (count == null) return resolved[0].value;
  return resolved.filter((x) => !x.done).map((x) => x.value);
}

export async function all<T>(generator: AsyncGenerator<T>) {
  const items = [];
  for await (const item of generator) {
    items.push(item);
  }
  return items;
}

/**
 * Merges an array of async generators into a single one
 * @param generators Generators to merge
 * @param randomly Whether to merge in random order
 */
export async function* mergeGenerators<T>(
  generators: AsyncGenerator<T>[],
  randomly = false
): AsyncGenerator<T> {
  let available;
  do {
    available = 0;
    if (randomly) generators = shuffle(generators);

    for (const generator of generators) {
      const item = await generator.next();
      if (item.done) continue;
      yield item.value;
      available++;

      if (randomly) break;
    }
  } while (available);
}

/**
 * Creates an async generator from any item or an array of items
 * @param from Source item or array
 */
export function generate<T>(
  from: T | T[] | Promise<T> | Promise<T[]>
): AsyncGenerator<T> {
  return (async function* () {
    from = await from;
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
      },
    };
  })(0);
}

type AsyncClonableGenerator<T> = AsyncGenerator<T> & {
  clone: () => AsyncClonableGenerator<T>;
};
